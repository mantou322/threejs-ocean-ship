import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

// --- Constants & Global Variables ---

// Scene, Camera, Renderer
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer();
renderer.setSize(window.innerWidth, window.innerHeight);
document.getElementById('container').appendChild(renderer.domElement);

// Camera Controls
let controls;

// Lights
const ambientLight = new THREE.AmbientLight(0x404040);
scene.add(ambientLight);
const directionalLight = new THREE.DirectionalLight(0xffffff, 0.5);
directionalLight.position.set(1, 1, 1);
scene.add(directionalLight);

// Ocean Shaders (Defined early)
const oceanVertexShader = `
  uniform float u_time; uniform float u_wave_amplitude; uniform float u_wave_frequency; uniform float u_wave_speed;
  varying vec2 vUv; varying float vWaveHeight;
  void main() {
    vUv = uv; vec3 pos = position;
    float wave1 = sin(pos.x * u_wave_frequency + u_time * u_wave_speed) * u_wave_amplitude;
    float wave2 = cos(pos.y * u_wave_frequency * 0.7 + u_time * u_wave_speed * 0.8) * u_wave_amplitude * 0.5;
    pos.z += wave1 + wave2; vWaveHeight = pos.z;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;
const oceanFragmentShader = `
  uniform vec3 u_water_color_deep; uniform vec3 u_water_color_shallow; uniform float u_opacity;
  varying vec2 vUv; varying float vWaveHeight;
  void main() {
    float waveFactor = smoothstep(-0.5, 0.5, vWaveHeight);
    vec3 waterColor = mix(u_water_color_deep, u_water_color_shallow, waveFactor);
    gl_FragColor = vec4(waterColor, u_opacity);
  }
`;

// Ship (Instance created after function definition)
const ship = createShip();
scene.add(ship);

// Ocean (Instance created after function definition)
const ocean = createOcean();
scene.add(ocean);

// Ship Path & Animation State
const path = new THREE.Line3(new THREE.Vector3(-10, 0.1, 0), new THREE.Vector3(10, 0.1, 0));
const shipSpeed = 0.02;
let pathProgress = 0;

// Animation Clock & Time
const clock = new THREE.Clock();
let elapsedTime = 0;

// --- Function Definitions ---

// Ship Creation
function createShip() {
    const shipGroup = new THREE.Group();
    const hullGeometry = new THREE.BoxGeometry(2, 0.5, 1);
    const hullMaterial = new THREE.MeshStandardMaterial({ color: 0x808080 });
    const hull = new THREE.Mesh(hullGeometry, hullMaterial);
    hull.name = "hull"; shipGroup.add(hull);
    const cabinGeometry = new THREE.BoxGeometry(0.8, 0.4, 0.6);
    const cabinMaterial = new THREE.MeshStandardMaterial({ color: 0xA0A0A0 });
    const cabin = new THREE.Mesh(cabinGeometry, cabinMaterial);
    cabin.name = "cabin"; cabin.position.y = 0.45; hull.add(cabin);
    return shipGroup;
}

// Ocean Creation
function createOcean() {
    const oceanGeometry = new THREE.PlaneGeometry(100, 100, 50, 50);
    const oceanMaterial = new THREE.ShaderMaterial({
        vertexShader: oceanVertexShader,
        fragmentShader: oceanFragmentShader,
        uniforms: {
            u_time: { value: 0.0 }, u_wave_amplitude: { value: 0.2 }, u_wave_frequency: { value: 0.3 },
            u_wave_speed: { value: 1.0 }, u_water_color_deep: { value: new THREE.Color(0x003366) },
            u_water_color_shallow: { value: new THREE.Color(0x005599) }, u_opacity: { value: 0.9 }
        },
        transparent: true, side: THREE.DoubleSide
    });
    const oceanPlane = new THREE.Mesh(oceanGeometry, oceanMaterial);
    oceanPlane.rotation.x = -Math.PI / 2; oceanPlane.position.y = -0.5;
    return oceanPlane;
}

// Initial Camera Position
camera.position.set(10, 10, 10);

// Wake Particle System
const MAX_WAKE_PARTICLES = 300;
const WAKE_PARTICLE_LIFETIME = 2.5;
const wakeParticlesGeometry = new THREE.BufferGeometry();
const wakeParticlePositions = new Float32Array(MAX_WAKE_PARTICLES * 3);
const wakeParticleAlphas = new Float32Array(MAX_WAKE_PARTICLES);
const wakeParticleSizes = new Float32Array(MAX_WAKE_PARTICLES);
const wakeParticleLifetimes = new Float32Array(MAX_WAKE_PARTICLES);
let wakeParticleIndex = 0;
for (let i = 0; i < MAX_WAKE_PARTICLES; i++) { wakeParticlePositions[i * 3 + 1] = -1000; }
wakeParticlesGeometry.setAttribute('position', new THREE.BufferAttribute(wakeParticlePositions, 3));
wakeParticlesGeometry.setAttribute('alpha', new THREE.BufferAttribute(wakeParticleAlphas, 1));
wakeParticlesGeometry.setAttribute('size', new THREE.BufferAttribute(wakeParticleSizes, 1));
const wakeParticleMaterial = new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(0xffffff) } },
    vertexShader: `attribute float size; attribute float alpha; varying float vAlpha; void main() { vAlpha = alpha; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_PointSize = size * (300.0 / -mvPosition.z); gl_Position = projectionMatrix * mvPosition; }`,
    fragmentShader: `uniform vec3 color; varying float vAlpha; void main() { if (vAlpha <= 0.0) discard; gl_FragColor = vec4(color, vAlpha); }`,
    transparent: true, depthWrite: false
});
const wakeParticles = new THREE.Points(wakeParticlesGeometry, wakeParticleMaterial);
scene.add(wakeParticles);
let lastShipPosition = new THREE.Vector3();
const WAKE_EMIT_THRESHOLD = 0.1;

function emitWakeParticle() {
    const idx = wakeParticleIndex % MAX_WAKE_PARTICLES;
    const offset = new THREE.Vector3(0, -0.1, 0.6).applyQuaternion(ship.quaternion);
    const emitPos = new THREE.Vector3().copy(ship.position).add(offset);
    wakeParticlePositions[idx*3]=emitPos.x+(Math.random()-.5)*.3; wakeParticlePositions[idx*3+1]=emitPos.y-.1; wakeParticlePositions[idx*3+2]=emitPos.z+(Math.random()-.5)*.3;
    wakeParticleAlphas[idx]=.7; wakeParticleLifetimes[idx]=WAKE_PARTICLE_LIFETIME; wakeParticleSizes[idx]=Math.random()*.15+.1;
    wakeParticleIndex++;
    wakeParticlesGeometry.attributes.position.needsUpdate=true; wakeParticlesGeometry.attributes.alpha.needsUpdate=true;
}
function updateWakeParticles(deltaTime) {
    if(ship.position.distanceTo(lastShipPosition)>WAKE_EMIT_THRESHOLD){emitWakeParticle();emitWakeParticle();lastShipPosition.copy(ship.position);}
    for(let i=0;i<MAX_WAKE_PARTICLES;i++){if(wakeParticleLifetimes[i]>0){wakeParticleLifetimes[i]-=deltaTime;if(wakeParticleLifetimes[i]<=0){wakeParticleAlphas[i]=0;}else{wakeParticleAlphas[i]=.7*(wakeParticleLifetimes[i]/WAKE_PARTICLE_LIFETIME);wakeParticlePositions[i*3]+=(Math.random()-.5)*.01;wakeParticlePositions[i*3+2]+=(Math.random()-.5)*.01;}}}
    if(wakeParticlesGeometry.attributes.position)wakeParticlesGeometry.attributes.position.needsUpdate=true;
    if(wakeParticlesGeometry.attributes.alpha)wakeParticlesGeometry.attributes.alpha.needsUpdate=true;
}

// Weather System Globals
const WeatherStates = { SUNNY: 'sunny', RAINY: 'rainy', SNOWY: 'snowy', STORMY: 'stormy', ICY: 'icy' };
let currentWeather = null;
let rainSystem = null, snowSystem = null, seaSpraySystem = null;
let icebergs = [];
const skyboxBaseUrl = 'textures/skybox/';
const sunnySkyboxUrls = ['px.jpg','nx.jpg','py.jpg','ny.jpg','pz.jpg','nz.jpg'].map(f=>`${skyboxBaseUrl}sunny/${f}`);
const rainySkyboxUrls = ['px.jpg','nx.jpg','py.jpg','ny.jpg','pz.jpg','nz.jpg'].map(f=>`${skyboxBaseUrl}rainy/${f}`);
const snowySkyboxUrls = ['px.jpg','nx.jpg','py.jpg','ny.jpg','pz.jpg','nz.jpg'].map(f=>`${skyboxBaseUrl}snowy/${f}`);
const stormySkyboxUrls = ['px.jpg','nx.jpg','py.jpg','ny.jpg','pz.jpg','nz.jpg'].map(f=>`${skyboxBaseUrl}stormy/${f}`);
const icySkyboxUrls = ['px.jpg','nx.jpg','py.jpg','ny.jpg','pz.jpg','nz.jpg'].map(f=>`${skyboxBaseUrl}icy/${f}`);
let sunnySkyboxTexture, rainySkyboxTexture, snowySkyboxTexture, stormySkyboxTexture, icySkyboxTexture;
const LOW_AMPLITUDE = 0.1, LOW_FREQUENCY = 0.25;
const HIGH_AMPLITUDE = 0.4, HIGH_FREQUENCY = 0.4;
const FOG_COLOR_RAINY = 0x667788, NEAR_FOG_RAINY = 10, FAR_FOG_RAINY = 40;
const FOG_COLOR_SNOWY = 0xAAAAAA, NEAR_FOG_SNOWY = 5, FAR_FOG_SNOWY = 30;
const FOG_COLOR_STORMY = 0x222233, NEAR_FOG_STORMY = 5, FAR_FOG_STORMY = 25;
const FOG_COLOR_ICY = 0xD0D8E0, NEAR_FOG_ICY = 20, FAR_FOG_ICY = 70;

// Skybox Loader Function (Defined before use in initializeSceneAndWeather)
function setupSkybox(textureUrls, callback) {
    if (typeof THREE.CubeTextureLoader === 'undefined' || textureUrls === null) {
        console.warn("CubeTextureLoader not available or no texture URLs. Using color backgrounds.");
        if (callback) callback(null); return;
    }
    new THREE.CubeTextureLoader().load(textureUrls, (t) => callback(t), undefined, (e) => {console.error('Skybox loading error:', e); callback(null);});
}

// Particle System Definitions
const MAX_RAIN_PARTICLES = 1500;
function createRainSystem() {
    const geo=new THREE.BufferGeometry(),pos=new Float32Array(MAX_RAIN_PARTICLES*3),vel=new Float32Array(MAX_RAIN_PARTICLES),area={x:30,y:20,z:30};
    for(let i=0;i<MAX_RAIN_PARTICLES;i++){pos[i*3]=(Math.random()-.5)*area.x;pos[i*3+1]=Math.random()*area.y;pos[i*3+2]=(Math.random()-.5)*area.z;vel[i]=Math.random()*.3+.2;}
    geo.setAttribute('position',new THREE.BufferAttribute(pos,3)); const mat=new THREE.PointsMaterial({color:0xAAAAEE,size:.05,transparent:true,opacity:.6,sizeAttenuation:false});
    const p=new THREE.Points(geo,mat);p.userData={velocities:vel,spawnAreaY:area.y,fallLimit:-5};return p;
}
function updateRain(dt) {
    if(!rainSystem||currentWeather!==WeatherStates.RAINY||!rainSystem.geometry)return; const {attributes,userData}=rainSystem.geometry;const pos=attributes.position.array,vel=userData.velocities,spawnY=userData.spawnAreaY,limit=userData.fallLimit,shipXZ=new THREE.Vector2(ship.position.x,ship.position.z);
    for(let i=0;i<pos.length/3;i++){pos[i*3+1]-=vel[i]*dt*60;if(pos[i*3+1]<limit){pos[i*3]=shipXZ.x+(Math.random()-.5)*30;pos[i*3+1]=spawnY+Math.random()*10;pos[i*3+2]=shipXZ.y+(Math.random()-.5)*30;}} attributes.position.needsUpdate=true;
}
const MAX_SNOW_PARTICLES = 1000;
function createSnowSystem() {
    const geo=new THREE.BufferGeometry(),pos=new Float32Array(MAX_SNOW_PARTICLES*3),vel=new Float32Array(MAX_SNOW_PARTICLES*3),area={x:40,y:25,z:40};
    for(let i=0;i<MAX_SNOW_PARTICLES;i++){pos[i*3]=(Math.random()-.5)*area.x;pos[i*3+1]=Math.random()*area.y;pos[i*3+2]=(Math.random()-.5)*area.z;vel[i*3]=(Math.random()-.5)*.03;vel[i*3+1]=Math.random()*.05+.05;vel[i*3+2]=(Math.random()-.5)*.03;}
    geo.setAttribute('position',new THREE.BufferAttribute(pos,3));const mat=new THREE.PointsMaterial({color:0xFFFFFF,size:.1,transparent:true,opacity:.8,sizeAttenuation:true});
    const p=new THREE.Points(geo,mat);p.userData={velocities:vel,spawnAreaY:area.y,fallLimit:-5};return p;
}
function updateSnow(dt) {
    if(!snowSystem||currentWeather!==WeatherStates.SNOWY||!snowSystem.geometry)return; const {attributes,userData}=snowSystem.geometry;const pos=attributes.position.array,vel=userData.velocities,spawnY=userData.spawnAreaY,limit=userData.fallLimit,shipXZ=new THREE.Vector2(ship.position.x,ship.position.z);
    for(let i=0;i<pos.length/3;i++){pos[i*3]+=vel[i*3]*dt*60;pos[i*3+1]-=vel[i*3+1]*dt*60;pos[i*3+2]+=vel[i*3+2]*dt*60;if(pos[i*3+1]<limit){pos[i*3]=shipXZ.x+(Math.random()-.5)*40;pos[i*3+1]=spawnY+Math.random()*10;pos[i*3+2]=shipXZ.y+(Math.random()-.5)*40;}pos[i*3]+=Math.sin(elapsedTime+i)*.01;} attributes.position.needsUpdate=true;
}
const MAX_SEASPRAY_PARTICLES = 500;
let sprayEmitCounter = 0;
function createSeaSpraySystem() {
    const geo=new THREE.BufferGeometry(),pos=new Float32Array(MAX_SEASPRAY_PARTICLES*3),vel=new Float32Array(MAX_SEASPRAY_PARTICLES*3),life=new Float32Array(MAX_SEASPRAY_PARTICLES),radius=10;
    for(let i=0;i<MAX_SEASPRAY_PARTICLES;i++){pos[i*3+1]=-1e3;vel[i*3]=(Math.random()-.5)*.3;vel[i*3+1]=Math.random()*.3+.2;vel[i*3+2]=(Math.random()-.5)*.3;life[i]=0;} geo.setAttribute('position',new THREE.BufferAttribute(pos,3));
    const mat=new THREE.PointsMaterial({color:0xFFFFFF,size:.15,transparent:true,opacity:.7,sizeAttenuation:true,depthWrite:false});
    const p=new THREE.Points(geo,mat);p.userData={velocities:vel,lifetimes:life,spawnRadius:radius};return p;
}
function updateSeaSpray(dt) {
    if(!seaSpraySystem||currentWeather!==WeatherStates.STORMY||!seaSpraySystem.geometry)return; const {attributes,userData}=seaSpraySystem.geometry;const pos=attributes.position.array,vel=userData.velocities,life=userData.lifetimes,radius=userData.spawnRadius,count=pos.length/3;sprayEmitCounter+=dt;
    if(sprayEmitCounter>.05){sprayEmitCounter=0;let emit=20;for(let j=0;j<emit;j++){let found=false;for(let i=0;i<count;i++){if(life[i]<=0){const angle=Math.random()*Math.PI*2,r=Math.random()*radius;pos[i*3]=ship.position.x+Math.cos(angle)*r;pos[i*3+1]=ocean.position.y+Math.random()*.5;pos[i*3+2]=ship.position.z+Math.sin(angle)*r;vel[i*3]=(Math.random()-.5)*.5;vel[i*3+1]=Math.random()*.5+.3;vel[i*3+2]=(Math.random()-.5)*.5;life[i]=Math.random()*.5+.3;found=true;break;}}if(!found)break;}}
    for(let i=0;i<count;i++){if(life[i]>0){life[i]-=dt;if(life[i]<=0){pos[i*3+1]=-1e3;continue;}pos[i*3]+=vel[i*3]*dt;pos[i*3+1]+=vel[i*3+1]*dt;pos[i*3+2]+=vel[i*3+2]*dt;vel[i*3+1]-=.98*dt;}} attributes.position.needsUpdate=true;seaSpraySystem.material.opacity=.7;
}
function createIcebergs(count) {
    const mat=new THREE.MeshStandardMaterial({color:0xE0E8FF,roughness:.3,metalness:.1});
    for(let i=0;i<count;i++){const sX=Math.random()*2+1,sY=Math.random()*1+.5,sZ=Math.random()*2+1;const geo=new THREE.BoxGeometry(sX,sY,sZ);const ice=new THREE.Mesh(geo,mat);ice.position.set((Math.random()-.5)*60,ocean.position.y+sY*.3-.1,(Math.random()-.5)*60);ice.rotation.set(Math.random()*Math.PI,Math.random()*Math.PI,Math.random()*Math.PI);scene.add(ice);icebergs.push(ice);}}

// Weather Application Functions
function applySunnyWeather(){scene.background=sunnySkyboxTexture||new THREE.Color(0x87CEEB);Object.assign(ocean.material.uniforms,{u_wave_amplitude:{value:LOW_AMPLITUDE},u_wave_frequency:{value:LOW_FREQUENCY},u_water_color_deep:{value:new THREE.Color(0x003366)},u_water_color_shallow:{value:new THREE.Color(0x005599)},u_opacity:{value:.9}});scene.fog=null;directionalLight.intensity=.7;ambientLight.intensity=.6;ambientLight.color.setHex(0x404040);}
function applyRainyWeather(){scene.background=rainySkyboxTexture||new THREE.Color(0x445566);Object.assign(ocean.material.uniforms,{u_wave_amplitude:{value:HIGH_AMPLITUDE},u_wave_frequency:{value:HIGH_FREQUENCY},u_water_color_deep:{value:new THREE.Color(0x223344)},u_water_color_shallow:{value:new THREE.Color(0x334455)},u_opacity:{value:.7}});scene.fog=new THREE.Fog(FOG_COLOR_RAINY,NEAR_FOG_RAINY,FAR_FOG_RAINY);directionalLight.intensity=.3;ambientLight.intensity=.4;ambientLight.color.setHex(0x404040);if(!rainSystem)rainSystem=createRainSystem();scene.add(rainSystem);}
function applySnowyWeather(){scene.background=snowySkyboxTexture||new THREE.Color(0xCCDDEE);Object.assign(ocean.material.uniforms,{u_wave_amplitude:{value:LOW_AMPLITUDE*.7},u_wave_frequency:{value:LOW_FREQUENCY*1.2},u_water_color_deep:{value:new THREE.Color(0x336677)},u_water_color_shallow:{value:new THREE.Color(0x77AACC)},u_opacity:{value:.95}});scene.fog=new THREE.Fog(FOG_COLOR_SNOWY,NEAR_FOG_SNOWY,FAR_FOG_SNOWY);directionalLight.intensity=.25;ambientLight.color.setHex(0x99aabb);ambientLight.intensity=.5;if(!snowSystem)snowSystem=createSnowSystem();scene.add(snowSystem);if(ship)ship.traverse(c=>{if(c.isMesh){if(!c.userData.originalMaterial&&c.material)c.userData.originalMaterial=c.material.clone();if(c.material)c.material.color.setHex(0xE0E0E0);}});}
function applyStormyWeather(){scene.background=stormySkyboxTexture||new THREE.Color(0x111122);Object.assign(ocean.material.uniforms,{u_wave_amplitude:{value:HIGH_AMPLITUDE*1.8},u_wave_frequency:{value:HIGH_FREQUENCY*.8},u_wave_speed:{value:1.8},u_water_color_deep:{value:new THREE.Color(0x102030)},u_water_color_shallow:{value:new THREE.Color(0x223344)},u_opacity:{value:.6}});scene.fog=new THREE.Fog(FOG_COLOR_STORMY,NEAR_FOG_STORMY,FAR_FOG_STORMY);directionalLight.intensity=.15;ambientLight.color.setHex(0x556677);ambientLight.intensity=.3;if(!seaSpraySystem)seaSpraySystem=createSeaSpraySystem();scene.add(seaSpraySystem);}
function applyIcyWeather(){scene.background=icySkyboxTexture||new THREE.Color(0xE8F0F8);Object.assign(ocean.material.uniforms,{u_wave_amplitude:{value:LOW_AMPLITUDE*.1},u_wave_frequency:{value:LOW_FREQUENCY*.5},u_wave_speed:{value:.1},u_water_color_deep:{value:new THREE.Color(0xB0C0D0)},u_water_color_shallow:{value:new THREE.Color(0xDDE8F0)},u_opacity:{value:.98}});directionalLight.intensity=.8;directionalLight.color.setHex(0xFFFFFF);ambientLight.color.setHex(0xbad4e8);ambientLight.intensity=.7;scene.fog=new THREE.Fog(FOG_COLOR_ICY,NEAR_FOG_ICY,FAR_FOG_ICY);createIcebergs(15);if(ship)ship.traverse(c=>{if(c.isMesh){if(!c.userData.originalMaterial&&c.material)c.userData.originalMaterial=c.material.clone();if(c.material)c.material.color.setHex(0xC0D0E0);}});}

// Master Weather Control
function setWeather(weatherState) {
    if(currentWeather===weatherState&&weatherState!==WeatherStates.ICY)return;console.log(`Setting weather to: ${weatherState}`);currentWeather=weatherState;
    if(rainSystem){scene.remove(rainSystem);rainSystem=null;} if(snowSystem){scene.remove(snowSystem);snowSystem=null;} if(seaSpraySystem){scene.remove(seaSpraySystem);seaSpraySystem=null;}
    icebergs.forEach(ice=>scene.remove(ice));icebergs=[];
    if(ship){ship.traverse(child=>{if(child.isMesh&&child.userData.originalMaterial){child.material=child.userData.originalMaterial;delete child.userData.originalMaterial;}else if(child.isMesh){if(child.name==="hull")child.material.color.setHex(0x808080);else if(child.name==="cabin")child.material.color.setHex(0xA0A0A0);}});}
    scene.fog=null;ambientLight.color.setHex(0x404040);ocean.material.uniforms.u_wave_speed.value=1.0;
    const displaySpan=document.getElementById('currentWeatherDisplay');if(displaySpan){displaySpan.textContent=weatherState.charAt(0).toUpperCase()+weatherState.slice(1);}
    switch(weatherState){case WeatherStates.SUNNY:applySunnyWeather();break;case WeatherStates.RAINY:applyRainyWeather();break;case WeatherStates.SNOWY:applySnowyWeather();break;case WeatherStates.STORMY:applyStormyWeather();break;case WeatherStates.ICY:applyIcyWeather();break;default:console.warn(`Unknown weather: ${weatherState}`);applySunnyWeather();}
}

// Initialization Functions
function initializeSceneAndWeather() {
    let skyboxesToLoad=5; const types=['sunny','rainy','snowy','stormy','icy']; const texArrays=[sunnySkyboxUrls,rainySkyboxUrls,snowySkyboxUrls,stormySkyboxUrls,icySkyboxUrls]; const texVars=[(t)=>{sunnySkyboxTexture=t},(t)=>{rainySkyboxTexture=t},(t)=>{snowySkyboxTexture=t},(t)=>{stormySkyboxTexture=t},(t)=>{icySkyboxTexture=t}];
    function onSkyboxLoaded(type,texture){if(texture)console.log(`${type} skybox loaded.`);else console.warn(`${type} skybox failed/skipped.`);texVars[types.indexOf(type)](texture);skyboxesToLoad--;if(skyboxesToLoad===0){console.log("Skybox setup complete. Initial weather.");setWeather(WeatherStates.SUNNY);}}
    if(typeof THREE.CubeTextureLoader!=='undefined'){types.forEach((type,idx)=>setupSkybox(texArrays[idx],t=>onSkyboxLoaded(type,t)));}else{console.warn("CubeTextureLoader undefined. Skipping all skyboxes.");types.forEach(type=>onSkyboxLoaded(type,null));}
}
function initControls() {
    if(!ship){console.warn("Ship not defined for controls.");return;} controls=new OrbitControls(camera,renderer.domElement);
    Object.assign(controls,{enableDamping:true,dampingFactor:.05,screenSpacePanning:false,minDistance:5,maxDistance:70,minPolarAngle:Math.PI/6,maxPolarAngle:Math.PI/1.8,enablePan:false});
    controls.target.copy(ship.position); controls.update();
}
function initUI() {
    document.getElementById('sunnyBtn').addEventListener('click',()=>setWeather(WeatherStates.SUNNY));
    document.getElementById('rainyBtn').addEventListener('click',()=>setWeather(WeatherStates.RAINY));
    document.getElementById('snowyBtn').addEventListener('click',()=>setWeather(WeatherStates.SNOWY));
    document.getElementById('stormyBtn').addEventListener('click',()=>setWeather(WeatherStates.STORMY));
    document.getElementById('icyBtn').addEventListener('click',()=>setWeather(WeatherStates.ICY));
}

// Main Animation Loop
function animate() {
    requestAnimationFrame(animate); const deltaTime=clock.getDelta(); elapsedTime+=deltaTime;
    ocean.material.uniforms.u_time.value=elapsedTime; pathProgress+=shipSpeed*deltaTime; if(pathProgress>1)pathProgress=0; path.at(pathProgress,ship.position);
    const waveAmp=ocean.material.uniforms.u_wave_amplitude.value,waveFreq=ocean.material.uniforms.u_wave_frequency.value,waveSpeedUniform=ocean.material.uniforms.u_wave_speed.value;
    function getWaveHeight(x,z,time){const w1=Math.sin(x*waveFreq+time*waveSpeedUniform)*waveAmp,w2=Math.cos(z*waveFreq*.7+time*waveSpeedUniform*.8)*waveAmp*.5;return w1+w2;}
    const currentWaveH=getWaveHeight(ship.position.x,ship.position.z,elapsedTime); ship.position.y=ocean.position.y+currentWaveH+.2;
    const dx=.01,dz=.01,hPx=getWaveHeight(ship.position.x+dx,ship.position.z,elapsedTime),hNx=getWaveHeight(ship.position.x-dx,ship.position.z,elapsedTime),hPz=getWaveHeight(ship.position.x,ship.position.z+dz,elapsedTime),hNz=getWaveHeight(ship.position.x,ship.position.z-dz,elapsedTime);
    const tanX=new THREE.Vector3(2*dx,hPx-hNx,0).normalize(),tanZ=new THREE.Vector3(0,hPz-hNz,2*dz).normalize(),waveN=new THREE.Vector3().crossVectors(tanZ,tanX).normalize();
    const lookAtT=new THREE.Vector3().copy(ship.position).add(path.delta(new THREE.Vector3()).normalize());lookAtT.y=ship.position.y+waveN.y*.5; ship.up.copy(waveN);ship.lookAt(lookAtT);
    if(typeof updateWakeParticles==='function')updateWakeParticles(deltaTime);
    if(currentWeather===WeatherStates.RAINY&&rainSystem)updateRain(deltaTime);
    if(currentWeather===WeatherStates.SNOWY&&snowSystem)updateSnow(deltaTime);
    if(currentWeather===WeatherStates.STORMY&&seaSpraySystem)updateSeaSpray(deltaTime);
    if(controls){controls.target.lerp(ship.position,.1);if(controls.enableDamping)controls.update();}
    renderer.render(scene,camera);
}

// Start Application
initializeSceneAndWeather(); initControls(); initUI(); animate();

// Handle window resize
window.addEventListener('resize',()=>{if(camera&&renderer){camera.aspect=window.innerWidth/window.innerHeight;camera.updateProjectionMatrix();renderer.setSize(window.innerWidth,window.innerHeight);}},false);
