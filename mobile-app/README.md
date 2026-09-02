# Einsdream Mobile 2.0 (React Native + Expo SDK 54)

Aplicación móvil nativa para monitorización acústica nocturna con **Foreground Service**, **Wake Lock**, buffer circular y sincronización fluida con el backend Einsdream en Vercel.

## 📱 Características
- **Modo Nocturno Simple**: Botón gigante `INICIAR MONITOREO` / `DETENER`.
- **Grabación en segundo plano**: Configurado con `staysActiveInBackground: true` para continuar capturando aunque la pantalla se apague.
- **Medidor de dB en vivo**: Detección continua del nivel sonoro con `Audio.Recording`.
- **Subida directa a la nube**: Conexión directa a `https://einsdreambcknd.vercel.app/api`.
- **Pre-Roll / Post-Roll**: Captura de segmentos con contexto real del evento.

## 🚀 Cómo ejecutar localmente
```bash
cd mobile-app
npm install
npx expo start
```

## 📦 Cómo compilar una nueva APK para Android
1. Instala EAS CLI:
   ```bash
   npm install -g eas-cli
   ```
2. Inicia sesión en tu cuenta Expo:
   ```bash
   eas login
   ```
3. Genera la APK compilada:
   ```bash
   eas build -p android --profile preview
   ```
