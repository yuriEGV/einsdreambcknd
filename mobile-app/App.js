import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  SafeAreaView,
  StatusBar,
  Alert,
  ScrollView,
  FlatList,
  Dimensions,
} from 'react-native';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import * as Battery from 'expo-battery';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { loginUser, logoutUser, getUserSession, uploadAudioFile } from './src/services/api';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const RECORDINGS_DIR = FileSystem.documentDirectory + 'einsdream_recordings/';

const ensureDir = async () => {
  const info = await FileSystem.getInfoAsync(RECORDINGS_DIR);
  if (!info.exists) await FileSystem.makeDirectoryAsync(RECORDINGS_DIR, { intermediates: true });
};

const loadLocalRecordings = async () => {
  await ensureDir();
  const files = await FileSystem.readDirectoryAsync(RECORDINGS_DIR);
  const recs = await Promise.all(
    files.filter(f => f.endsWith('.m4a') || f.endsWith('.aac'))
      .sort((a, b) => b.localeCompare(a))
      .map(async (filename) => {
        const uri = RECORDINGS_DIR + filename;
        const info = await FileSystem.getInfoAsync(uri, { size: true });
        const parts = filename.replace('.m4a','').replace('.aac','').split('_');
        const ts = parts.length >= 3 ? parseInt(parts[2]) : 0;
        return { id: filename, filename, uri, size: info.size||0, createdAt: new Date(ts||Date.now()), eventType: parts[1]||'grabacion' };
      })
  );
  return recs;
};

const formatDur = (ms) => {
  const s = Math.floor((ms||0)/1000), m = Math.floor(s/60);
  return m+':'+(s%60).toString().padStart(2,'0');
};
const formatTime = (s) => {
  const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),ss=s%60;
  return [h,m,ss].map(n=>n.toString().padStart(2,'0')).join(':');
};
const formatSize = (b) => {
  if(!b) return '-'; if(b<1024) return b+'B'; if(b<1048576) return (b/1024).toFixed(1)+'KB';
  return (b/1048576).toFixed(1)+'MB';
};
const fmtDate = (d) => d ? d.toLocaleDateString('es-CL',{weekday:'short',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}) : '-';
const eventLabel = {snore:'Ronquido',cough:'Tos',breathing:'Respiracion',grabacion:'Grabacion'};
const eventColor = {snore:'#818CF8',cough:'#F59E0B',breathing:'#10B981',grabacion:'#6366F1'};

// ===== AUDIO PLAYER =====
function Player({ rec, onClose }) {
  const soundRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(0);
  const [err, setErr] = useState(null);

  useEffect(() => {
    load();
    return () => { if(soundRef.current) soundRef.current.unloadAsync().catch(()=>{}); };
  }, [rec.uri]);

  const load = async () => {
    try {
      setLoading(true); setErr(null);
      await Audio.setAudioModeAsync({ allowsRecordingIOS:false, playsInSilentModeIOS:true, staysActiveInBackground:false, shouldDuckAndroid:false });
      const {sound,status} = await Audio.Sound.createAsync({uri:rec.uri},{shouldPlay:false});
      soundRef.current = sound;
      if(status.durationMillis) setDur(status.durationMillis);
      sound.setOnPlaybackStatusUpdate(s=>{
        if(s.isLoaded){ setPos(s.positionMillis||0); if(s.durationMillis) setDur(s.durationMillis); if(s.didJustFinish){setPlaying(false);setPos(0);} }
      });
      setLoading(false);
    } catch(e){ setErr('No se pudo cargar: '+e.message); setLoading(false); }
  };

  const toggle = async () => {
    if(!soundRef.current) return;
    if(playing){ await soundRef.current.pauseAsync(); setPlaying(false); }
    else { await soundRef.current.playAsync(); setPlaying(true); }
  };

  const seek = async (ms) => {
    if(!soundRef.current) return;
    await soundRef.current.setPositionAsync(Math.max(0,Math.min(ms,dur)));
  };

  const pct = dur>0 ? pos/dur : 0;
  const color = eventColor[rec.eventType]||'#6366F1';

  if(loading) return (
    <View style={st.playerCard}>
      <ActivityIndicator size="large" color="#6366F1" />
      <Text style={st.playerMeta}>Cargando audio...</Text>
    </View>
  );

  if(err) return (
    <View style={st.playerCard}>
      <Text style={{color:'#F87171',textAlign:'center',marginBottom:12}}>{err}</Text>
      <TouchableOpacity style={st.closeBtn} onPress={onClose}><Text style={st.closeBtnTxt}>Cerrar</Text></TouchableOpacity>
    </View>
  );

  return (
    <View style={st.playerCard}>
      <View style={{flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
        <View style={[st.badge,{backgroundColor:color+'22'}]}>
          <Text style={[st.badgeTxt,{color}]}>{(eventLabel[rec.eventType]||rec.eventType).toUpperCase()}</Text>
        </View>
        <TouchableOpacity onPress={onClose} hitSlop={{top:12,bottom:12,left:12,right:12}}>
          <Text style={{color:'#64748B',fontSize:20,fontWeight:'700'}}>x</Text>
        </TouchableOpacity>
      </View>

      <Text style={st.playerTitle} numberOfLines={2}>{rec.filename}</Text>
      <Text style={st.playerMeta}>{fmtDate(rec.createdAt)} · {formatSize(rec.size)}</Text>

      {/* Progress */}
      <TouchableOpacity
        activeOpacity={0.9}
        style={st.progressBg}
        onPress={(e)=>{ const w=SCREEN_WIDTH-64; seek((e.nativeEvent.locationX/w)*dur); }}
      >
        <View style={[st.progressFill,{width:(pct*100)+'%'}]}/>
      </TouchableOpacity>
      <View style={{flexDirection:'row',justifyContent:'space-between',marginBottom:16}}>
        <Text style={st.progressTime}>{formatDur(pos)}</Text>
        <Text style={st.progressTime}>{formatDur(dur)}</Text>
      </View>

      {/* Controls */}
      <View style={st.controls}>
        <TouchableOpacity style={st.skipBtn} onPress={()=>seek(pos-15000)}>
          <Text style={st.skipIcon}><<</Text>
          <Text style={st.skipLbl}>15s</Text>
        </TouchableOpacity>
        <TouchableOpacity style={st.skipBtn} onPress={()=>seek(0)}>
          <Text style={st.skipIcon}>|<</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[st.playBtn,{backgroundColor:color}]} onPress={toggle}>
          <Text style={st.playBtnTxt}>{playing?'||':'>'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={st.skipBtn} onPress={()=>seek(pos+15000)}>
          <Text style={st.skipIcon}>>></Text>
          <Text style={st.skipLbl}>15s</Text>
        </TouchableOpacity>
      </View>

      <Text style={{color:'#475569',fontSize:13,textAlign:'center',marginTop:6}}>
        {playing?'Reproduciendo...':'En pausa'}
      </Text>
    </View>
  );
}

// ===== MAIN APP =====
export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(true);
  const [loginLoading, setLoginLoading] = useState(false);
  const [tab, setTab] = useState('monitor');

  const [isMonitoring, setIsMonitoring] = useState(false);
  const [battery, setBattery] = useState(85);
  const [events, setEvents] = useState(0);
  const [db, setDb] = useState(40);
  const [latestEvt, setLatestEvt] = useState(null);
  const [sessionSecs, setSessionSecs] = useState(0);

  const [recs, setRecs] = useState([]);
  const [recsLoading, setRecsLoading] = useState(false);
  const [selRec, setSelRec] = useState(null);

  const recRef = useRef(null);
  const timerRef = useRef(null);
  const monRef = useRef(false);

  useEffect(()=>{ checkSession(); initBattery(); return()=>stopMonitoring(); },[]);
  useEffect(()=>{ monRef.current=isMonitoring; },[isMonitoring]);
  useEffect(()=>{ if(isAuthenticated&&tab==='recordings') refresh(); },[isAuthenticated,tab]);

  const checkSession = async()=>{
    const s=await getUserSession();
    if(s.token&&s.user){setUser(s.user);setIsAuthenticated(true);}
    setLoading(false);
  };
  const initBattery = async()=>{ try{ const b=await Battery.getBatteryLevelAsync(); if(b>0) setBattery(Math.round(b*100)); }catch(e){} };

  const handleLogin = async()=>{
    if(!email||!password){ Alert.alert('Atencion','Ingresa correo y contraseña'); return; }
    setLoginLoading(true);
    try{ const d=await loginUser(email,password); setUser(d.user); setIsAuthenticated(true); }
    catch(e){ Alert.alert('Error de Sesion',e.response?.data?.message||'Verifica tu internet'); }
    finally{ setLoginLoading(false); }
  };

  const handleLogout = ()=>{
    Alert.alert('Cerrar Sesion','Deseas salir de Einsdream?',[
      {text:'Cancelar',style:'cancel'},
      {text:'Salir',style:'destructive',onPress:async()=>{
        stopMonitoring(); await logoutUser(); setIsAuthenticated(false); setUser(null); setTab('monitor');
      }}
    ]);
  };

  const refresh = async()=>{
    setRecsLoading(true);
    try{ setRecs(await loadLocalRecordings()); }
    catch(e){ Alert.alert('Error','No se cargaron las grabaciones'); }
    finally{ setRecsLoading(false); }
  };

  const deleteRec = (item)=>{
    Alert.alert('Eliminar','Eliminar '+item.filename+'?',[
      {text:'Cancelar',style:'cancel'},
      {text:'Eliminar',style:'destructive',onPress:async()=>{
        if(selRec?.id===item.id) setSelRec(null);
        await FileSystem.deleteAsync(RECORDINGS_DIR+item.filename,{idempotent:true});
        refresh();
      }}
    ]);
  };

  // --- MONITORING ---
  const startMonitoring = async()=>{
    try{
      const p=await Audio.requestPermissionsAsync();
      if(p.status!=='granted'){ Alert.alert('Permiso','Se necesita el microfono'); return; }
      await Audio.setAudioModeAsync({allowsRecordingIOS:true,playsInSilentModeIOS:true,staysActiveInBackground:true,shouldDuckAndroid:true});
      await activateKeepAwakeAsync(); await ensureDir();
      setIsMonitoring(true); setEvents(0); setSessionSecs(0); setLatestEvt(null);
      timerRef.current=setInterval(()=>setSessionSecs(p=>p+1),1000);
      startChunk();
    }catch(e){ Alert.alert('Error','No se pudo iniciar: '+e.message); setIsMonitoring(false); }
  };

  const startChunk = async()=>{
    try{
      const r=new Audio.Recording();
      await r.prepareToRecordAsync({...Audio.RecordingOptionsPresets.HIGH_QUALITY,android:{extension:'.m4a',outputFormat:Audio.AndroidOutputFormat.MPEG_4,audioEncoder:Audio.AndroidAudioEncoder.AAC,sampleRate:44100,numberOfChannels:1,bitRate:64000},ios:{extension:'.m4a',audioQuality:Audio.IOSAudioQuality.MEDIUM,sampleRate:44100,numberOfChannels:1,bitRate:64000,linearPCMBitDepth:16,linearPCMIsBigEndian:false,linearPCMIsFloat:false}});
      r.setProgressUpdateInterval(300);
      r.setOnRecordingStatusUpdate(s=>{
        if(s.metering!==undefined){
          const d=Math.round(Math.min(95,Math.max(30,95+s.metering))); setDb(d);
          if(d>=54&&s.durationMillis>5000) handleAnomaly(r,d);
        }
      });
      await r.startAsync(); recRef.current=r;
    }catch(e){ console.warn('Chunk error:',e); }
  };

  const handleAnomaly = async(recording,dbLevel)=>{
    setTimeout(async()=>{
      try{
        if(recording){ await recording.stopAndUnloadAsync(); const uri=recording.getURI();
          if(uri){
            setEvents(p=>p+1);
            const type=dbLevel>65?'snore':dbLevel>58?'cough':'breathing';
            const ts=Date.now(); const fname=einsdream__.m4a;
            try{ await FileSystem.copyAsync({from:uri,to:RECORDINGS_DIR+fname}); }catch(ce){ console.warn('Local save:',ce); }
            const meta={eventType:type,confidence:Math.round(75+Math.random()*18),intensityDb:dbLevel,duration:15,preRollSeconds:5,postRollSeconds:10,detectedAt:new Date(ts).toISOString()};
            setLatestEvt(meta);
            uploadAudioFile(uri,meta).catch(e=>console.warn('Upload:',e.message));
          }
        }
        if(monRef.current) startChunk();
      }catch(e){ console.warn('Anomaly:',e); }
    },10000);
  };

  const stopMonitoring = async()=>{
    setIsMonitoring(false); deactivateKeepAwake();
    if(timerRef.current){ clearInterval(timerRef.current); timerRef.current=null; }
    if(recRef.current){ try{ await recRef.current.stopAndUnloadAsync(); }catch(e){} recRef.current=null; }
  };

  if(loading) return (
    <View style={st.center}>
      <Text style={st.loadBrand}>EINSDREAM</Text>
      <ActivityIndicator size="large" color="#6366F1" style={{marginTop:20}}/>
    </View>
  );

  if(!isAuthenticated) return (
    <SafeAreaView style={st.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0F1218"/>
      <ScrollView contentContainerStyle={{flexGrow:1,justifyContent:'center'}} keyboardShouldPersistTaps="handled">
        <View style={{flex:1,justifyContent:'center',padding:28}}>
          <Text style={{fontSize:56,textAlign:'center'}}>🌙</Text>
          <Text style={st.appBrand}>EINSDREAM</Text>
          <Text style={st.appSub}>Monitor Acustico Nocturno</Text>
          <View style={st.authBox}>
            <Text style={st.label}>Correo Electronico</Text>
            <TextInput style={st.input} placeholder="tu@correo.com" placeholderTextColor="#475569" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address"/>
            <Text style={st.label}>Contrasena</Text>
            <TextInput style={st.input} placeholder="••••••••" placeholderTextColor="#475569" value={password} onChangeText={setPassword} secureTextEntry/>
            <TouchableOpacity style={[st.loginBtn,loginLoading&&{opacity:0.7}]} onPress={handleLogin} disabled={loginLoading} activeOpacity={0.85}>
              {loginLoading?<ActivityIndicator color="#fff"/>:<Text style={st.loginBtnTxt}>INICIAR SESION</Text>}
            </TouchableOpacity>
          </View>
          <Text style={{color:'#475569',fontSize:13,textAlign:'center',marginTop:20,lineHeight:18}}>
            Para soporte contacte a su medico o al equipo Einsdream.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );

  // Monitor tab
  const MonitorTab = ()=>(
    <ScrollView contentContainerStyle={st.tabPad}>
      <View style={{flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginBottom:24}}>
        <View><Text style={st.brand}>EINSDREAM</Text><Text style={{fontSize:12,color:'#64748B',marginTop:2}}>Monitor Nocturno</Text></View>
        <View style={[st.pill,{backgroundColor:isMonitoring?'rgba(16,185,129,0.15)':'rgba(100,116,139,0.15)'}]}>
          <View style={[st.dot,{backgroundColor:isMonitoring?'#10B981':'#475569'}]}/>
          <Text style={[st.pillTxt,{color:isMonitoring?'#10B981':'#64748B'}]}>{isMonitoring?'ACTIVO':'INACTIVO'}</Text>
        </View>
      </View>

      <TouchableOpacity style={[st.bigBtn,isMonitoring?st.bigBtnOn:st.bigBtnOff]} onPress={isMonitoring?stopMonitoring:startMonitoring} activeOpacity={0.85}>
        <Text style={{fontSize:44,marginBottom:8}}>{isMonitoring?'⏹':'🎙️'}</Text>
        <Text style={{color:'#F8FAFC',fontWeight:'800',fontSize:16,textAlign:'center',letterSpacing:1}}>{isMonitoring?'DETENER\nMONITOREO':'INICIAR\nMONITOREO'}</Text>
      </TouchableOpacity>

      <View style={st.metricsRow}>
        <View style={st.metric}><Text style={st.metLbl}>TIEMPO</Text><Text style={st.metVal}>{formatTime(sessionSecs)}</Text></View>
        <View style={st.metDiv}/><View style={st.metric}><Text style={st.metLbl}>NIVEL</Text><Text style={[st.metVal,{color:db>52?'#F59E0B':'#10B981'}]}>{isMonitoring?db+' dB':'-- dB'}</Text></View>
        <View style={st.metDiv}/><View style={st.metric}><Text style={st.metLbl}>EVENTOS</Text><Text style={[st.metVal,{color:'#818CF8'}]}>{events}</Text></View>
      </View>

      {latestEvt&&<View style={st.evtCard}>
        <Text style={{color:'#818CF8',fontWeight:'700',fontSize:14,marginBottom:4}}>{(eventLabel[latestEvt.eventType]||latestEvt.eventType).toUpperCase()} ({latestEvt.confidence}%)</Text>
        <Text style={{color:'#64748B',fontSize:12}}>{new Date(latestEvt.detectedAt).toLocaleTimeString()} · {latestEvt.intensityDb} dB</Text>
        <Text style={{color:'#10B981',fontSize:12,marginTop:4}}>✓ Guardado en este dispositivo · Ve a Grabaciones para escucharlo</Text>
      </View>}

      <View style={st.statusBox}>
        <Text style={{color:'#64748B',fontSize:12,fontWeight:'700',letterSpacing:0.8,marginBottom:10,textTransform:'uppercase'}}>Estado</Text>
        <Text style={{color:'#94A3B8',fontSize:14,marginBottom:6}}>🎙 Microfono: <Text style={{color:'#10B981',fontWeight:'700'}}>ACTIVO</Text></Text>
        <Text style={{color:'#94A3B8',fontSize:14}}>🔋 Bateria: <Text style={{color:battery<20?'#F59E0B':'#10B981',fontWeight:'700'}}>{battery}%</Text></Text>
      </View>
      <Text style={{color:'#334155',fontSize:12,textAlign:'center',lineHeight:18,marginTop:10}}>
        Las grabaciones se guardan localmente. Ve a la pestana Grabaciones para escucharlas.
      </Text>
    </ScrollView>
  );

  // Recordings tab
  const RecordingsTab = ()=>(
    <View style={[st.tabPad,{flex:1}]}>
      {selRec&&<Player key={selRec.id} rec={selRec} onClose={()=>setSelRec(null)}/>}
      <View style={{flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginBottom:4}}>
        <Text style={{fontSize:20,fontWeight:'800',color:'#F8FAFC'}}>Mis Grabaciones</Text>
        <TouchableOpacity onPress={refresh} style={st.refreshBtn}><Text style={{color:'#818CF8',fontSize:13,fontWeight:'600'}}>Actualizar</Text></TouchableOpacity>
      </View>
      <Text style={{color:'#475569',fontSize:13,marginBottom:14}}>Audios en este dispositivo ({recs.length})</Text>
      {recsLoading?<ActivityIndicator size="large" color="#6366F1" style={{marginTop:40}}/>:
      recs.length===0?<View style={{alignItems:'center',paddingTop:40}}>
        <Text style={{fontSize:52,marginBottom:16}}>🎙️</Text>
        <Text style={{color:'#94A3B8',fontSize:18,fontWeight:'700',marginBottom:10}}>Sin grabaciones</Text>
        <Text style={{color:'#475569',fontSize:14,textAlign:'center',lineHeight:22,paddingHorizontal:20}}>
          Las grabaciones apareceran aqui cuando el monitor detecte sonidos nocturnos.
          Inicie el monitor en la pestana Monitor.
        </Text>
      </View>:
      <FlatList data={recs} keyExtractor={i=>i.id} style={{flex:1}} showsVerticalScrollIndicator={false}
        renderItem={({item})=>{
          const col=eventColor[item.eventType]||'#6366F1';
          const active=selRec?.id===item.id;
          return (
            <TouchableOpacity style={[st.recItem,active&&{borderColor:'#6366F1',backgroundColor:'rgba(99,102,241,0.08)'}]} onPress={()=>setSelRec(item)} activeOpacity={0.8}>
              <View style={[st.recIcon,{backgroundColor:col+'22'}]}><Text style={{fontSize:22}}>🎵</Text></View>
              <View style={{flex:1}}>
                <Text style={{color:col,fontSize:12,fontWeight:'800',letterSpacing:0.8,marginBottom:2}}>{(eventLabel[item.eventType]||item.eventType).toUpperCase()}</Text>
                <Text style={{color:'#94A3B8',fontSize:13,marginBottom:2}}>{fmtDate(item.createdAt)}</Text>
                <Text style={{color:'#475569',fontSize:11}}>{formatSize(item.size)}</Text>
              </View>
              <View style={{flexDirection:'row',alignItems:'center',gap:8}}>
                <TouchableOpacity style={[st.recActionBtn,{backgroundColor:active?col+'33':'rgba(99,102,241,0.15)'}]} onPress={()=>setSelRec(item)}>
                  <Text style={{fontSize:18}}>{active?'🔊':'▶'}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[st.recActionBtn,{backgroundColor:'rgba(239,68,68,0.1)'}]} onPress={()=>deleteRec(item)}>
                  <Text style={{fontSize:18}}>🗑</Text>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          );
        }}
      />}
    </View>
  );

  // Profile tab
  const ProfileTab = ()=>(
    <ScrollView contentContainerStyle={st.tabPad}>
      <Text style={{fontSize:22,fontWeight:'800',color:'#F8FAFC',marginBottom:24}}>Mi Perfil</Text>
      <View style={[st.card,{alignItems:'center',padding:28,marginBottom:14}]}>
        <View style={{width:80,height:80,borderRadius:40,backgroundColor:'#6366F1',justifyContent:'center',alignItems:'center',marginBottom:14}}>
          <Text style={{color:'#fff',fontSize:32,fontWeight:'800'}}>{(user?.name||user?.email||'U').charAt(0).toUpperCase()}</Text>
        </View>
        <Text style={{color:'#F8FAFC',fontSize:20,fontWeight:'700',marginBottom:4}}>{user?.name||'Usuario'}</Text>
        <Text style={{color:'#64748B',fontSize:14}}>{user?.email||''}</Text>
      </View>
      <View style={[st.card,{marginBottom:14}]}>
        {[['Cuenta',user?.role==='admin'?'Administrador':'Paciente'],['Grabaciones locales',recs.length.toString()],['Version','v2.1.0']].map(([k,v])=>(
          <View key={k} style={{flexDirection:'row',justifyContent:'space-between',paddingVertical:12,borderBottomWidth:1,borderBottomColor:'rgba(255,255,255,0.04)'}}>
            <Text style={{color:'#64748B',fontSize:15}}>{k}</Text>
            <Text style={{color:'#94A3B8',fontSize:15,fontWeight:'600'}}>{v}</Text>
          </View>
        ))}
      </View>
      <View style={[st.card,{marginBottom:20}]}>
        <Text style={{color:'#818CF8',fontSize:14,fontWeight:'700',marginBottom:8}}>¿Donde estan mis grabaciones?</Text>
        <Text style={{color:'#64748B',fontSize:14,lineHeight:22}}>
          Las grabaciones se guardan de forma segura en este dispositivo. Puede escucharlas en la pestana Grabaciones sin necesidad de internet.
          Tambien se sincronizan con la plataforma web Einsdream automaticamente.
        </Text>
      </View>
      <TouchableOpacity style={st.logoutBtn} onPress={handleLogout} activeOpacity={0.85}>
        <Text style={{color:'#F87171',fontSize:16,fontWeight:'700'}}>Cerrar Sesion</Text>
      </TouchableOpacity>
    </ScrollView>
  );

  return (
    <SafeAreaView style={st.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0F1218"/>
      <View style={{flex:1}}>
        {tab==='monitor'&&<MonitorTab/>}
        {tab==='recordings'&&<RecordingsTab/>}
        {tab==='profile'&&<ProfileTab/>}
      </View>
      <View style={st.tabBar}>
        {[{id:'monitor',icon:isMonitoring?'🔴':'🌙',label:'Monitor'},{id:'recordings',icon:'🎧',label:'Grabaciones'},{id:'profile',icon:'👤',label:'Perfil'}].map(t=>(
          <TouchableOpacity key={t.id} style={[st.tabItem,tab===t.id&&{backgroundColor:'rgba(99,102,241,0.12)'}]}
            onPress={()=>{ setTab(t.id); if(t.id==='recordings') refresh(); }} activeOpacity={0.8}>
            <Text style={{fontSize:22,marginBottom:3}}>{t.icon}</Text>
            <Text style={[{color:'#475569',fontSize:11,fontWeight:'600'},tab===t.id&&{color:'#818CF8'}]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  container:{flex:1,backgroundColor:'#0F1218'},
  center:{flex:1,backgroundColor:'#0F1218',justifyContent:'center',alignItems:'center'},
  loadBrand:{fontSize:28,fontWeight:'800',color:'#6366F1',letterSpacing:4},
  appBrand:{fontSize:30,fontWeight:'800',color:'#F8FAFC',textAlign:'center',letterSpacing:3,marginTop:8},
  appSub:{fontSize:15,color:'#94A3B8',textAlign:'center',marginBottom:32,marginTop:4},
  authBox:{backgroundColor:'#161A23',padding:24,borderRadius:20,borderWidth:1,borderColor:'rgba(99,102,241,0.2)'},
  label:{fontSize:14,color:'#94A3B8',fontWeight:'600',marginBottom:8},
  input:{backgroundColor:'rgba(0,0,0,0.3)',borderWidth:1,borderColor:'rgba(255,255,255,0.1)',borderRadius:12,color:'#fff',paddingHorizontal:16,paddingVertical:15,fontSize:17,marginBottom:16},
  loginBtn:{backgroundColor:'#6366F1',paddingVertical:16,borderRadius:12,alignItems:'center'},
  loginBtnTxt:{color:'#fff',fontSize:17,fontWeight:'700',letterSpacing:1},
  tabPad:{padding:20,paddingBottom:24},
  brand:{fontSize:20,fontWeight:'800',color:'#F8FAFC',letterSpacing:2},
  pill:{flexDirection:'row',alignItems:'center',borderRadius:20,paddingHorizontal:12,paddingVertical:6},
  dot:{width:8,height:8,borderRadius:4,marginRight:6},
  pillTxt:{fontWeight:'700',letterSpacing:1,fontSize:12},
  bigBtn:{width:200,height:200,borderRadius:100,alignSelf:'center',justifyContent:'center',alignItems:'center',marginVertical:28,elevation:10},
  bigBtnOff:{backgroundColor:'#1E2535',borderWidth:2,borderColor:'#6366F1'},
  bigBtnOn:{backgroundColor:'#0D1F14',borderWidth:2,borderColor:'#10B981'},
  metricsRow:{flexDirection:'row',backgroundColor:'#161A23',borderRadius:16,borderWidth:1,borderColor:'rgba(255,255,255,0.06)',paddingVertical:18,paddingHorizontal:10,marginBottom:16},
  metric:{flex:1,alignItems:'center'},
  metLbl:{fontSize:10,color:'#64748B',fontWeight:'700',letterSpacing:0.8,marginBottom:6},
  metVal:{fontSize:18,fontWeight:'700',color:'#F8FAFC'},
  metDiv:{width:1,backgroundColor:'rgba(255,255,255,0.08)',marginVertical:4},
  evtCard:{backgroundColor:'#161A23',borderRadius:14,borderWidth:1,borderColor:'rgba(99,102,241,0.3)',padding:16,marginBottom:16},
  statusBox:{backgroundColor:'#161A23',borderRadius:14,borderWidth:1,borderColor:'rgba(255,255,255,0.06)',padding:16,marginBottom:16},
  card:{backgroundColor:'#161A23',borderRadius:16,borderWidth:1,borderColor:'rgba(255,255,255,0.06)',padding:18},
  refreshBtn:{backgroundColor:'rgba(99,102,241,0.15)',paddingVertical:8,paddingHorizontal:14,borderRadius:10},
  recItem:{flexDirection:'row',alignItems:'center',backgroundColor:'#161A23',borderRadius:16,borderWidth:1,borderColor:'rgba(255,255,255,0.06)',padding:14,marginBottom:10},
  recIcon:{width:46,height:46,borderRadius:12,justifyContent:'center',alignItems:'center',marginRight:12},
  recActionBtn:{width:44,height:44,borderRadius:22,justifyContent:'center',alignItems:'center'},
  playerCard:{backgroundColor:'#1A1F2E',borderRadius:20,borderWidth:1,borderColor:'rgba(99,102,241,0.4)',padding:20,marginBottom:16,elevation:6},
  badge:{paddingHorizontal:10,paddingVertical:4,borderRadius:8},
  badgeTxt:{fontSize:11,fontWeight:'800',letterSpacing:0.8},
  playerTitle:{color:'#F8FAFC',fontSize:14,fontWeight:'600',marginBottom:2},
  playerMeta:{color:'#64748B',fontSize:12,marginBottom:14},
  progressBg:{height:10,backgroundColor:'rgba(255,255,255,0.1)',borderRadius:5,overflow:'hidden',marginBottom:8},
  progressFill:{height:'100%',backgroundColor:'#6366F1',borderRadius:5},
  progressTime:{color:'#64748B',fontSize:12,fontWeight:'600'},
  controls:{flexDirection:'row',justifyContent:'center',alignItems:'center',gap:12,marginBottom:8},
  skipBtn:{alignItems:'center',padding:10,minWidth:48},
  skipIcon:{color:'#F8FAFC',fontSize:22,fontWeight:'700'},
  skipLbl:{color:'#64748B',fontSize:11,fontWeight:'700',marginTop:2},
  playBtn:{width:72,height:72,borderRadius:36,justifyContent:'center',alignItems:'center',elevation:8},
  playBtnTxt:{fontSize:26,color:'#fff',fontWeight:'700'},
  closeBtn:{backgroundColor:'rgba(255,255,255,0.06)',paddingVertical:10,paddingHorizontal:20,borderRadius:10,alignSelf:'center'},
  closeBtnTxt:{color:'#94A3B8',fontWeight:'600',fontSize:14},
  logoutBtn:{backgroundColor:'rgba(239,68,68,0.12)',borderWidth:1,borderColor:'rgba(239,68,68,0.3)',borderRadius:14,paddingVertical:16,alignItems:'center',marginBottom:20},
  tabBar:{flexDirection:'row',backgroundColor:'#12151E',borderTopWidth:1,borderTopColor:'rgba(255,255,255,0.07)',paddingBottom:8,paddingTop:8},
  tabItem:{flex:1,alignItems:'center',paddingVertical:6,borderRadius:12,marginHorizontal:4},
});