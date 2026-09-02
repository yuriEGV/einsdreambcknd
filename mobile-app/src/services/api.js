import axios from 'axios';
import * as SecureStore from 'expo-secure-store';

export const BASE_URL = 'https://einsdreambcknd.vercel.app';
export const API_URL = `${BASE_URL}/api`;

const api = axios.create({
  baseURL: API_URL,
  timeout: 20000,
});

api.interceptors.request.use(async (config) => {
  try {
    const token = await SecureStore.getItemAsync('userToken');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  } catch (e) {}
  return config;
});

export const loginUser = async (email, password) => {
  const res = await api.post('/auth/login', { email, password });
  if (res.data.token) {
    await SecureStore.setItemAsync('userToken', res.data.token);
    await SecureStore.setItemAsync('userData', JSON.stringify(res.data.user));
  }
  return res.data;
};

export const logoutUser = async () => {
  await SecureStore.deleteItemAsync('userToken');
  await SecureStore.deleteItemAsync('userData');
};

export const getUserSession = async () => {
  try {
    const token = await SecureStore.getItemAsync('userToken');
    const userStr = await SecureStore.getItemAsync('userData');
    return {
      token,
      user: userStr ? JSON.parse(userStr) : null
    };
  } catch {
    return { token: null, user: null };
  }
};

export const uploadAudioFile = async (fileUri, eventMeta) => {
  const filename = fileUri.split('/').pop() || `night_event_${Date.now()}.m4a`;

  // 1. Initialize upload
  const initRes = await api.post('/upload/init', {
    filename,
    contentType: 'audio/m4a'
  });

  const { uploadMethod, url, fileKey } = initRes.data;

  // 2. Upload file via FormData or Presigned PUT
  if (uploadMethod === 'PUT' && url.startsWith('http')) {
    const response = await fetch(fileUri);
    const blob = await response.blob();
    await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'audio/m4a' },
      body: blob
    });
  } else {
    // Local / Server upload
    const formData = new FormData();
    formData.append('audio', {
      uri: fileUri,
      type: 'audio/m4a',
      name: filename
    });
    await api.post('/upload/local', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
  }

  // 3. Save Metadata
  const metaRes = await api.post('/upload/metadata', {
    s3Key: fileKey,
    storageKey: fileKey,
    duration: eventMeta.duration || 15,
    deviceModel: 'Android App Einsdream v2.0',
    eventType: eventMeta.eventType || 'unknown',
    confidence: eventMeta.confidence || 85,
    intensityDb: eventMeta.intensityDb || 58,
    preRollSeconds: eventMeta.preRollSeconds || 5,
    postRollSeconds: eventMeta.postRollSeconds || 10,
    detectedAt: eventMeta.detectedAt || new Date().toISOString(),
    sessionGroup: `night_${new Date().toISOString().slice(0, 10)}`
  });

  return metaRes.data;
};

export default api;
