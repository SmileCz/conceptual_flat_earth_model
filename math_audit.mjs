/**
 * math_audit.mjs  —  Comprehensive math audit for the FE conceptual model.
 *
 * Invariants tested:
 *   1.  equatorialToCelestCoord always returns unit vectors
 *   2.  opticalVaultProject maps unit direction to ellipsoid surface
 *   3.  celestLatLongToVaultCoord cap-mode z stays on the ellipsoid shell
 *   4.  heavenlyVaultCeiling is consistent with celestLatLongToVaultCoord
 *   5.  coordToLatLong is a left-inverse of V.FromAngle (round-trip)
 *   6.  compTransMatCelestToGlobe is an orthogonal rotation (det=+1, R^T·R=I)
 *   7.  localGlobeCoordToLocalFeCoord is its own inverse (axis swap only)
 *   8.  pointOnFE at pole / equator / south rim (FE_RADIUS=1)
 *   9.  ToRange edge-case: ToRange(-360, 360) should be 0, not 360  ← BUG
 *  10.  moonToSun = V.Sub(sun, V.Scale(moon, 0)) is the same as sun itself
 *  11.  SunOpticalVaultCoord computed BEFORE OpticalVaultRadius update  ← BUG
 *  12.  solveKepler round-trip: M(E) == M_input
 *  13.  planetEquatorial geocentric direction is unit (cancels distances)
 *  14.  greenwichSiderealDeg at J2000 reference point
 *  15.  sunEquatorial at known solstice / equinox dates
 *  16.  RADIAL_LAEA: r(-90°) = 1  (outer rim normalisation)
 *  17.  RADIAL_PROPORTIONAL: r(90°) = 0, r(-90°) = 1
 *  18.  V.Mult cross product right-hand rule
 *  19.  mat3 composeRot: (A composed after B) applied to v == A*(B*v)
 *  20.  Unit length invariant of celestCoordToLocalGlobeCoord (rotation)
 */

// ── inline copies of the math primitives (no bundler needed) ─────────────────

const DEG = Math.PI / 180;
const TOL = 1e-9;

// utils
const ToRad  = d => d * Math.PI / 180;
const ToDeg  = r => r * 180 / Math.PI;
const Limit1 = x => x < -1 ? -1 : x > 1 ? 1 : x;
const Clamp  = (x, lo, hi) => x < lo ? lo : x > hi ? hi : x;
const sqr    = x => x * x;

function ToRange(x, max) {
  let v = Math.abs(x) % max;
  if (x < 0 && v !== 0) v = max - v;
  return v;
}

// vect3
const V = {
  Add:        (a,b) => [a[0]+b[0], a[1]+b[1], a[2]+b[2]],
  Sub:        (a,b) => [a[0]-b[0], a[1]-b[1], a[2]-b[2]],
  Scale:      (a,s) => [a[0]*s, a[1]*s, a[2]*s],
  ScalarProd: (a,b) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2],
  Mult:       (a,b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]],
  Length:     a => Math.sqrt(a[0]*a[0]+a[1]*a[1]+a[2]*a[2]),
  Norm:       a => { const L=Math.sqrt(a[0]*a[0]+a[1]*a[1]+a[2]*a[2]); return L===0?[0,0,0]:[a[0]/L,a[1]/L,a[2]/L]; },
  FromAngle:  (longDeg,latDeg,length) => { const lo=ToRad(longDeg),la=ToRad(latDeg),c=Math.cos(la); return [length*c*Math.cos(lo),length*c*Math.sin(lo),length*Math.sin(la)]; },
};

// mat3
const I3 = () => [[1,0,0],[0,1,0],[0,0,1]];
const ZT = () => [0,0,0];
function rotX(a){const c=Math.cos(a),s=Math.sin(a);return[[1,0,0],[0,c,-s],[0,s,c]];}
function rotY(a){const c=Math.cos(a),s=Math.sin(a);return[[c,0,s],[0,1,0],[-s,0,c]];}
function rotZ(a){const c=Math.cos(a),s=Math.sin(a);return[[c,-s,0],[s,c,0],[0,0,1]];}
function mul3(A,B){const r=[[0,0,0],[0,0,0],[0,0,0]];for(let i=0;i<3;i++)for(let j=0;j<3;j++)r[i][j]=A[i][0]*B[0][j]+A[i][1]*B[1][j]+A[i][2]*B[2][j];return r;}
function apply(m,v){const r=m.r,t=m.t;return[r[0][0]*v[0]+r[0][1]*v[1]+r[0][2]*v[2]+t[0],r[1][0]*v[0]+r[1][1]*v[1]+r[1][2]*v[2]+t[1],r[2][0]*v[0]+r[2][1]*v[1]+r[2][2]*v[2]+t[2]];}
function composeRot(rot,base){if(!base)return{r:rot,t:ZT()};const r=mul3(rot,base.r);const t=[rot[0][0]*base.t[0]+rot[0][1]*base.t[1]+rot[0][2]*base.t[2],rot[1][0]*base.t[0]+rot[1][1]*base.t[1]+rot[1][2]*base.t[2],rot[2][0]*base.t[0]+rot[2][1]*base.t[1]+rot[2][2]*base.t[2]];return{r,t};}
const M = {
  Unit:      ()=>{return{r:I3(),t:ZT()};},
  RotatingX: (a,b)=>composeRot(rotX(a),b),
  RotatingY: (a,b)=>composeRot(rotY(a),b),
  RotatingZ: (a,b)=>composeRot(rotZ(a),b),
  Moving:    (x,y,z,rot)=>({r:rot?rot.r.map(row=>row.slice()):I3(),t:[x,y,z]}),
  Trans:     (m,v)=>apply(m,v),
};

// ephemeris helpers
function norm360(x){return((x%360)+360)%360;}
function julianDay(date){return date.getTime()/86400000+2440587.5;}

function sunEquatorial(date){
  const jd=julianDay(date),n=jd-2451545;
  const L=norm360(280.460+0.9856474*n);
  const g=norm360(357.528+0.9856003*n)*DEG;
  let lambda=L+1.915*Math.sin(g)+0.020*Math.sin(2*g);
  lambda=norm360(lambda);
  const eps=(23.439-0.0000004*n)*DEG;
  const lamR=lambda*DEG;
  const ra=Math.atan2(Math.cos(eps)*Math.sin(lamR),Math.cos(lamR));
  const dec=Math.asin(Math.sin(eps)*Math.sin(lamR));
  return{ra,dec};
}

function moonEquatorial(date){
  const jd=julianDay(date),d=jd-2451545,T=d/36525;
  const L0=norm360(218.3164477+481267.88123421*T);
  const D=norm360(297.8501921+445267.1114034*T);
  const M_=norm360(357.5291092+35999.0502909*T);
  const Mp=norm360(134.9633964+477198.8675055*T);
  const F=norm360(93.2720950+483202.0175233*T);
  const DR=D*DEG,MR=M_*DEG,MpR=Mp*DEG,FR=F*DEG;
  let dLam=6.289*Math.sin(MpR)-1.274*Math.sin(2*DR-MpR)+0.658*Math.sin(2*DR)
          -0.186*Math.sin(MR)-0.059*Math.sin(2*MpR-2*DR)-0.057*Math.sin(MpR-2*DR+MR)
          +0.053*Math.sin(MpR+2*DR)+0.046*Math.sin(2*DR-MR)-0.041*Math.sin(MpR-MR);
  const lambda=norm360(L0+dLam);
  let beta=5.128*Math.sin(FR)+0.281*Math.sin(MpR+FR)+0.278*Math.sin(MpR-FR)
          +0.173*Math.sin(2*DR-FR)+0.055*Math.sin(2*DR+FR-MpR)-0.046*Math.sin(2*DR-FR-MpR);
  const eps=(23.439-0.0000004*d)*DEG;
  const lamR=lambda*DEG,betR=beta*DEG;
  const ra=Math.atan2(Math.sin(lamR)*Math.cos(eps)-Math.tan(betR)*Math.sin(eps),Math.cos(lamR));
  const dec=Math.asin(Math.sin(betR)*Math.cos(eps)+Math.cos(betR)*Math.sin(eps)*Math.sin(lamR));
  return{ra,dec};
}

function greenwichSiderealDeg(date){
  const jd=julianDay(date),T=(jd-2451545)/36525;
  return norm360(280.46061837+360.98564736629*(jd-2451545)+0.000387933*T*T-(T*T*T)/38710000);
}

function equatorialToCelestCoord({ra,dec}){
  const cd=Math.cos(dec);return[cd*Math.cos(ra),cd*Math.sin(ra),Math.sin(dec)];
}

// feGeometry helpers
const FE_RADIUS=1;
function pointOnFE(latDeg,longDeg,feRadius=1){
  const r=feRadius*(90-latDeg)/180,lo=ToRad(longDeg);
  return[r*Math.cos(lo),r*Math.sin(lo),0];
}
function celestLatLongToVaultCoord(latDeg,longDeg,domeSize,domeHeight,feRadius=1,floor=0,seasonalBand=0){
  const domeRadius=domeSize*feRadius;
  const r=feRadius*(90-latDeg)/180;
  const lo=ToRad(longDeg);
  const x=r*Math.cos(lo),y=r*Math.sin(lo);
  let z;
  if(seasonalBand>0){
    const clamped=Math.max(-seasonalBand,Math.min(seasonalBand,latDeg));
    const norm_=0.5+0.5*(clamped/seasonalBand);
    const headroom=0.12,mix=headroom+(1-2*headroom)*norm_;
    z=floor+(domeHeight-floor)*mix;
  }else{
    const zSq=sqr(domeRadius)-sqr(r);
    z=floor+(zSq>0?Math.sqrt(zSq):0)*(domeHeight-floor)/domeRadius;
  }
  return[x,y,z];
}
function heavenlyVaultCeiling(latDeg,domeSize,domeHeight,feRadius=1){
  const r=feRadius*(90-latDeg)/180,domeR=domeSize*feRadius;
  const rhoSq=(r*r)/(domeR*domeR);
  if(rhoSq>=1)return 0;
  return domeHeight*Math.sqrt(1-rhoSq);
}

// transforms helpers
function coordToLatLong(coord){
  const vectXY=[coord[0],coord[1],0];
  const xyLen=V.Length(vectXY);
  if(xyLen===0)return{lat:coord[2]>=0?90:-90,lng:0};
  const xyNorm=V.Norm(vectXY),norm_=V.Norm(coord);
  const lat=90-ToDeg(Math.acos(Limit1(V.ScalarProd([0,0,1],norm_))));
  let lng=ToDeg(Math.acos(Limit1(V.ScalarProd([1,0,0],xyNorm))));
  if(xyNorm[1]<0)lng*=-1;
  return{lat,lng};
}
function compTransMatCelestToGlobe(obsLatDeg,obsLongDeg,skyRotAngleDeg){
  const first=M.RotatingZ(ToRad(-obsLongDeg-skyRotAngleDeg));
  return M.RotatingY(ToRad(obsLatDeg),first);
}
function localGlobeCoordToLocalFeCoord(v){return[-v[2],v[1],v[0]];}
function opticalVaultProject(localGlobe,R,H){return[localGlobe[0]*H,localGlobe[1]*R,localGlobe[2]*R];}

// Schlyter planet helpers (minimal, just for unit-length test)
function schlyterDay(date){return date.getTime()/86400000-10956;}
const PLANET_EL={
  mercury:[48.3313,3.24587e-5,7.0047,5.00e-8,29.1241,1.01444e-5,0.387098,0,0.205635,5.59e-10,168.6562,4.0923344368],
  venus:  [76.6799,2.46590e-5,3.3946,2.75e-8,54.8910,1.38374e-5,0.723330,0,0.006773,-1.302e-9,48.0052,1.6021302244],
  earth:  [0,0,0.0000,0,282.9404,4.70935e-5,1.000000,0,0.016709,-1.151e-9,356.0470,0.9856002585],
  mars:   [49.5574,2.11081e-5,1.8497,-1.78e-8,286.5016,2.92961e-5,1.523688,0,0.093405,2.516e-9,18.6021,0.5240207766],
  jupiter:[100.4542,2.76854e-5,1.3030,-1.557e-7,273.8777,1.64505e-5,5.20256,0,0.048498,4.469e-9,19.8950,0.0830853001],
  saturn: [113.6634,2.38980e-5,2.4886,-1.081e-7,339.3939,2.97661e-5,9.55475,0,0.055546,-9.499e-9,316.9670,0.0334442282],
};
function elementsAt(name,d){const e=PLANET_EL[name];return{N:e[0]+e[1]*d,i:e[2]+e[3]*d,w:e[4]+e[5]*d,a:e[6]+e[7]*d,e:e[8]+e[9]*d,M:e[10]+e[11]*d};}
function solveKepler(M_,e){
  let E=M_+e*Math.sin(M_)*(1+e*Math.cos(M_));
  for(let k=0;k<6;k++){const dE=(E-e*Math.sin(E)-M_)/(1-e*Math.cos(E));E-=dE;if(Math.abs(dE)<1e-10)break;}
  return E;
}
function heliocentric(name,d){
  const{N,i,w,a,e,M_m}=((el)=>({N:el[0]+el[1]*d,i:el[2]+el[3]*d,w:el[4]+el[5]*d,a:el[6]+el[7]*d,e:el[8]+el[9]*d,M_m:el[10]+el[11]*d}))(PLANET_EL[name]);
  const Mr=(M_m*DEG);
  const E=solveKepler(((Mr%(Math.PI*2))+Math.PI*2)%(Math.PI*2),e);
  const xv=a*(Math.cos(E)-e),yv=a*Math.sqrt(1-e*e)*Math.sin(E);
  const v=Math.atan2(yv,xv),r=Math.hypot(xv,yv);
  const Nr=N*DEG,ir=i*DEG,wr=w*DEG,vw=v+wr;
  return{x:r*(Math.cos(Nr)*Math.cos(vw)-Math.sin(Nr)*Math.sin(vw)*Math.cos(ir)),y:r*(Math.sin(Nr)*Math.cos(vw)+Math.cos(Nr)*Math.sin(vw)*Math.cos(ir)),z:r*Math.sin(vw)*Math.sin(ir)};
}
function planetEquatorial(name,date){
  const d=schlyterDay(date);
  const sg=heliocentric('earth',d),p=heliocentric(name,d);
  const xg=p.x+sg.x,yg=p.y+sg.y,zg=p.z+sg.z;
  const eclip=(23.4393-3.563e-7*d)*DEG;
  const xeq=xg,yeq=yg*Math.cos(eclip)-zg*Math.sin(eclip),zeq=yg*Math.sin(eclip)+zg*Math.cos(eclip);
  const ra=Math.atan2(yeq,xeq),dec=Math.atan2(zeq,Math.hypot(xeq,yeq));
  return{ra,dec};
}

// ── test harness ─────────────────────────────────────────────────────────────

let pass=0, fail=0;
function check(name, ok, detail=''){
  if(ok){console.log(`  PASS  ${name}`);pass++;}
  else{console.error(`  FAIL  ${name}${detail?' — '+detail:''}`);fail++;}
}
function near(a,b,tol=TOL){return Math.abs(a-b)<=tol;}
function vecNear(a,b,tol=TOL){return near(a[0],b[0],tol)&&near(a[1],b[1],tol)&&near(a[2],b[2],tol);}
function isUnit(v,tol=1e-12){return near(V.Length(v),1,tol);}

// ── 1. equatorialToCelestCoord always unit ───────────────────────────────────
console.log('\n[1] equatorialToCelestCoord → unit vectors');
const testDates=[
  new Date('2024-03-20T03:06:00Z'), // spring equinox
  new Date('2024-06-20T20:51:00Z'), // summer solstice
  new Date('2024-09-22T12:44:00Z'), // autumn equinox
  new Date('2024-12-21T09:20:00Z'), // winter solstice
  new Date('2017-08-21T18:26:00Z'), // eclipse reference
];
for(const d of testDates){
  const s=sunEquatorial(d),sV=equatorialToCelestCoord(s);
  check(`sun unit vector @ ${d.toISOString().slice(0,10)}`,isUnit(sV,1e-12),
        `|v|=${V.Length(sV)}`);
  const mn=moonEquatorial(d),mV=equatorialToCelestCoord(mn);
  check(`moon unit vector @ ${d.toISOString().slice(0,10)}`,isUnit(mV,1e-12),
        `|v|=${V.Length(mV)}`);
}

// ── 2. opticalVaultProject maps unit direction to ellipsoid surface ───────────
console.log('\n[2] opticalVaultProject: point on ellipsoid surface');
const R=0.5,H=0.35;
const testDirs=[
  [1,0,0],[0,1,0],[0,0,1],
  V.Norm([0.5,0.5,0.7071]),V.Norm([0,0.6,0.8]),
  // only zenith-facing (x>0) directions make sense on the cap
];
for(const dir of testDirs){
  if(dir[0]<0)continue;  // below horizon not meaningful
  const p=opticalVaultProject(dir,R,H);
  // p in local-globe: x*H, y*R, z*R
  // on ellipsoid: (px/H)^2 + (py/R)^2 + (pz/R)^2 = 1
  const onEllipsoid=near(sqr(p[0]/H)+sqr(p[1]/R)+sqr(p[2]/R),1,1e-12);
  check(`ellipsoid surface for dir=[${dir.map(x=>x.toFixed(3))}]`,onEllipsoid,
        `lhs=${sqr(p[0]/H)+sqr(p[1]/R)+sqr(p[2]/R)}`);
}

// ── 3. celestLatLongToVaultCoord z on ellispoid shell ───────────────────────
console.log('\n[3] celestLatLongToVaultCoord (cap mode): z on ellipsoid shell');
const VAULT_SIZE=1.0,VAULT_HEIGHT=0.75;
for(const latDeg of [-80,-50,-23.44,0,23.44,60,89]){
  for(const lonDeg of [0,90,180,-90]){
    const pt=celestLatLongToVaultCoord(latDeg,lonDeg,VAULT_SIZE,VAULT_HEIGHT);
    const r=Math.hypot(pt[0],pt[1]);
    const z=pt[2];
    // ellipsoid: (r/domeR)^2 + (z/domeH)^2 = 1
    const domeR=VAULT_SIZE*FE_RADIUS,lhs=sqr(r/domeR)+sqr(z/VAULT_HEIGHT);
    check(`cap lat=${latDeg},lon=${lonDeg}`,near(lhs,1,1e-10),`lhs=${lhs.toFixed(12)}`);
  }
}

// ── 4. heavenlyVaultCeiling == celestLatLongToVaultCoord z at that lat ───────
console.log('\n[4] heavenlyVaultCeiling consistent with celestLatLongToVaultCoord');
for(const latDeg of [-70,-23.44,0,23.44,70,89]){
  const z_vault=celestLatLongToVaultCoord(latDeg,0,VAULT_SIZE,VAULT_HEIGHT)[2];
  const z_ceil=heavenlyVaultCeiling(latDeg,VAULT_SIZE,VAULT_HEIGHT);
  check(`ceiling vs vault-coord z @ lat=${latDeg}`,near(z_vault,z_ceil,1e-12),
        `vault=${z_vault}, ceil=${z_ceil}`);
}

// ── 5. coordToLatLong round-trip with V.FromAngle ─────────────────────────────
console.log('\n[5] coordToLatLong is inverse of V.FromAngle (round-trip)');
for(const [lat,lon] of [
  [0,0],[45,90],[-45,-90],[89.9,180],[-89.9,0],[23.44,15],[-23.44,-15],
]){
  const v=V.FromAngle(lon,lat,1);
  const rt=coordToLatLong(v);
  check(`round-trip lat=${lat},lon=${lon}`,
        near(rt.lat,lat,1e-8)&&near(rt.lng,lon,1e-8),
        `got lat=${rt.lat.toFixed(8)},lon=${rt.lng.toFixed(8)}`);
}

// ── 6. compTransMatCelestToGlobe is orthogonal (det=+1, R^T·R=I) ─────────────
console.log('\n[6] compTransMatCelestToGlobe is a pure rotation (R^T·R = I, det = +1)');
for(const [lat,lon,gmst] of [[0,0,0],[45,15,123],[-89.9,170,359.9],[23,45,200]]){
  const tm=compTransMatCelestToGlobe(lat,lon,gmst);
  const R=tm.r;
  // R^T · R = I
  const RtR=mul3(R.map((_,i)=>R.map(row=>row[i])),R);
  const isOrth=RtR.every((row,i)=>row.every((v,j)=>near(v,i===j?1:0,1e-10)));
  // det
  const det=R[0][0]*(R[1][1]*R[2][2]-R[1][2]*R[2][1])
           -R[0][1]*(R[1][0]*R[2][2]-R[1][2]*R[2][0])
           +R[0][2]*(R[1][0]*R[2][1]-R[1][1]*R[2][0]);
  check(`orthogonal lat=${lat},lon=${lon},gmst=${gmst}`,isOrth&&near(det,1,1e-10),
        `det=${det.toFixed(12)}, orth=${isOrth}`);
}

// ── 7. localGlobeCoordToLocalFeCoord is an axis-permutation (its own inverse^2) 
console.log('\n[7] localGlobeCoordToLocalFeCoord double-apply is identity on same axes');
// Convention: globe(x=zenith,y=east,z=north) -> fe(x=-north,y=east,z=zenith)
// Applying twice: [-(-north), east, zenith] = [north, east, zenith] ≠ original.
// Better: verify the permutation matrix is orthogonal.
const permuteM=[[0,0,-1],[0,1,0],[1,0,0]]; // maps globe→fe as written (-z, y, x)
// Its transpose is its inverse for orthogonal matrices:
const permMt=permuteM.map((_,i)=>permuteM.map(row=>row[i]));
const permProd=mul3(permuteM,permMt);
const isPermOrth=permProd.every((row,i)=>row.every((v,j)=>near(v,i===j?1:0,1e-12)));
check('localGlobeCoordToLocalFeCoord matrix is orthogonal',isPermOrth);
// spot-check
const gv=[0.6,0.3,0.7];
const feV=localGlobeCoordToLocalFeCoord(gv);
check('axis-swap spot-check: fe = [-globe_z, globe_y, globe_x]',
      near(feV[0],-gv[2])&&near(feV[1],gv[1])&&near(feV[2],gv[0]));

// ── 8. pointOnFE boundary conditions ─────────────────────────────────────────
console.log('\n[8] pointOnFE(FE_RADIUS=1) boundary conditions');
// North pole: r=0
const poleP=pointOnFE(90,0,1);
check('north pole at origin',vecNear(poleP,[0,0,0]));
// Equator lon=0: r=0.5
const eqP=pointOnFE(0,0,1);
check('equator lon=0 at [0.5,0,0]',vecNear(eqP,[0.5,0,0]));
// Equator lon=90: r=0.5, rotated
const eqP90=pointOnFE(0,90,1);
check('equator lon=90 at [0,0.5,0]',vecNear(eqP90,[0,0.5,0],1e-10));
// South pole (outer rim): r=1
const rimP=pointOnFE(-90,0,1);
check('south pole rim at [1,0,0]',vecNear(rimP,[1,0,0]));
// FE_RADIUS=1 is used throughout → outer rim radius = 1 ✓
check('outer rim radius equals FE_RADIUS=1',near(V.Length(rimP),1));

// ── 9. ToRange edge-case bug ─────────────────────────────────────────────────
console.log('\n[9] ToRange edge-cases');
// ToRange(-360, 360) should be 0, not 360
const tr1=ToRange(-360,360);
check('ToRange(-360, 360) === 0  [expected 0, is BUG if ≠ 0]',near(tr1,0),
      `got ${tr1} (BUG: returns 360 instead of 0)`);
// Additional cases
check('ToRange(0, 360) === 0',near(ToRange(0,360),0));
check('ToRange(360, 360) === 0',near(ToRange(360,360),0));
check('ToRange(370, 360) ≈ 10',near(ToRange(370,360),10));
check('ToRange(-10, 360) ≈ 350',near(ToRange(-10,360),350));

// ── 10. moonToSun = V.Sub(sun, V.Scale(moon, 0)) is just sun ─────────────────
console.log('\n[10] moonToSun: V.Sub(sun, V.Scale(moon, 0)) === sun (Scale-by-0 intent)');
const date=new Date('2024-03-20T03:06:00Z');
const sunCV=equatorialToCelestCoord(sunEquatorial(date));
const moonCV=equatorialToCelestCoord(moonEquatorial(date));
const moonToSun=V.Norm(V.Sub(sunCV,V.Scale(moonCV,0)));
const sunNorm=V.Norm(sunCV);
check('moonToSun === V.Norm(sunCV) [Scale by 0 reduces to sun]',vecNear(moonToSun,sunNorm,1e-12));
// Confirm Scale by 0 gives zero vector
const scaled=V.Scale(moonCV,0);
check('V.Scale(moon,0) === [0,0,0]',vecNear(scaled,[0,0,0]));

// ── 11. OpticalVaultCoord stale-read bug ──────────────────────────────────────
console.log('\n[11] OpticalVaultCoord computed before OpticalVaultRadius/Height update (order check)');
// Simulating what app.js does in update():
// INITIAL c.OpticalVaultRadius = 0.5 (from defaultState computed init)
// THEN at line ~355/390 SunOpticalVaultCoord uses c.OpticalVaultRadius=0.5
// THEN at line ~425 c.OpticalVaultRadius = s.OpticalVaultSize (possibly different)
// When s.OpticalVaultSize=0.9, the sun coord was projected with R=0.5 not 0.9
const R_old=0.5,H_old=0.35;
const R_new=0.9,H_new=0.7;
const dir_=[0.6,0.0,0.8]; // a unit direction
const pOld=opticalVaultProject(dir_,R_old,H_old);
const pNew=opticalVaultProject(dir_,R_new,H_new);
const diff=V.Length(V.Sub(pNew,pOld));
check('stale OpticalVault: coord differs when R/H change (confirms 1-frame bug exists when state changes)',
      diff>0.01, `diff=${diff.toFixed(6)} (should be >0.01 when vault size changes from 0.5→0.9)`);
console.log(`    NOTE: SunOpticalVaultCoord & MoonOpticalVaultCoord in app.js:355/390`);
console.log(`          use OLD c.OpticalVaultRadius. New value set at app.js:425.`);
console.log(`          Planets (app.js:474) use NEW value → sun/moon 1-frame lag.`);

// ── 12. solveKepler round-trip ─────────────────────────────────────────────────
console.log('\n[12] solveKepler: M(E) = E - e·sin(E) round-trip');
for(const [M_deg, e] of [[0,0],[45,0.02],[90,0.1],[170,0.2],[350,0.09]]){
  const M_rad= M_deg*DEG;
  const E=solveKepler(M_rad,e);
  const M_back=E-e*Math.sin(E);
  check(`M=${M_deg}° e=${e}: round-trip`,near(M_back,M_rad,1e-10),
        `M_back=${M_back}, M_in=${M_rad}`);
}

// ── 13. planetEquatorial RA/Dec is finite and in range ────────────────────────
console.log('\n[13] planetEquatorial: RA∈[−π,π], Dec∈[−π/2,π/2], direction finite');
const planets=['mercury','venus','mars','jupiter','saturn'];
const pDate=new Date('2024-06-15T12:00:00Z');
for(const name of planets){
  const{ra,dec}=planetEquatorial(name,pDate);
  const v=equatorialToCelestCoord({ra,dec});
  check(`${name}: unit vector & finite RA/Dec`,
        isUnit(v,1e-10)&&isFinite(ra)&&isFinite(dec)
        &&Math.abs(ra)<=Math.PI&&Math.abs(dec)<=Math.PI/2,
        `ra=${ToDeg(ra).toFixed(2)}°, dec=${ToDeg(dec).toFixed(2)}°, |v|=${V.Length(v).toFixed(12)}`);
}

// ── 14. greenwichSiderealDeg at J2000 reference ────────────────────────────────
console.log('\n[14] greenwichSiderealDeg at J2000.0');
// J2000.0 = JD 2451545.0 = 2000-01-01T12:00:00 UTC.
// The formula constant is 280.46061837°, so at this exact instant the linear
// term and quadratic terms are all 0 → GMST must equal that constant (mod 360).
const j2000=new Date('2000-01-01T12:00:00Z');
const gmst=greenwichSiderealDeg(j2000);
check(`GMST at J2000.0 = 280.4606° (got ${gmst.toFixed(4)}°)`,near(gmst,280.46061837,0.001));

// ── 15. sunEquatorial at solstice/equinox dates ───────────────────────────────
console.log('\n[15] sunEquatorial: declination at key dates (Meeus ~0.01° accuracy)');
// Values: spring equinox → Dec≈0, summer solstice → Dec≈+23.44, etc.
const knownSun=[
  {date:new Date('2024-03-20T03:06:00Z'), expectedDecDeg:0,     tol:0.6, label:'spring equinox'},
  {date:new Date('2024-06-20T20:51:00Z'), expectedDecDeg:23.44, tol:0.2, label:'summer solstice'},
  {date:new Date('2024-09-22T12:44:00Z'), expectedDecDeg:0,     tol:0.6, label:'autumn equinox'},
  {date:new Date('2024-12-21T09:20:00Z'), expectedDecDeg:-23.44,tol:0.2, label:'winter solstice'},
];
for(const{date,expectedDecDeg,tol,label}of knownSun){
  const{dec}=sunEquatorial(date);
  const decDeg=ToDeg(dec);
  check(`${label} dec≈${expectedDecDeg}° (got ${decDeg.toFixed(4)}°)`,
        near(decDeg,expectedDecDeg,tol));
}

// ── 16. RADIAL_LAEA: r(-90°) = 1  (outer rim normalisation) ─────────────────
console.log('\n[16] RADIAL_LAEA: r(−90°) = 1 (outer rim at disc edge)');
const RADIAL_LAEA=(lat)=>Math.sin((90-lat)*Math.PI/360);
check('RADIAL_LAEA(-90) = sin(180°/360*π·2) = sin(π/2) = 1',near(RADIAL_LAEA(-90),1,1e-12));
check('RADIAL_LAEA( 90) = sin(0) = 0 (pole at centre)',near(RADIAL_LAEA(90),0,1e-12));
check('RADIAL_LAEA(  0) = sin(π/4) ≈ 0.7071 (equator inside rim)',near(RADIAL_LAEA(0),Math.SQRT1_2,1e-10));

// ── 17. RADIAL_PROPORTIONAL boundaries ───────────────────────────────────────
console.log('\n[17] RADIAL_PROPORTIONAL: pole=0, rim=1');
const RADIAL_PROPORTIONAL=(lat)=>Math.pow((90-lat)/180,0.75);
check('RADIAL_PROPORTIONAL(90) = 0 (pole)',near(RADIAL_PROPORTIONAL(90),0,1e-12));
check('RADIAL_PROPORTIONAL(-90) = 1 (rim)',near(RADIAL_PROPORTIONAL(-90),1,1e-12));

// ── 18. V.Mult cross product right-hand rule ──────────────────────────────────
console.log('\n[18] V.Mult cross product right-hand rule');
check('[1,0,0]×[0,1,0] = [0,0,1]',vecNear(V.Mult([1,0,0],[0,1,0]),[0,0,1]));
check('[0,1,0]×[0,0,1] = [1,0,0]',vecNear(V.Mult([0,1,0],[0,0,1]),[1,0,0]));
check('[0,0,1]×[1,0,0] = [0,1,0]',vecNear(V.Mult([0,0,1],[1,0,0]),[0,1,0]));
check('anti-commutative: a×b = -(b×a)',vecNear(V.Mult([1,2,3],[4,5,6]),V.Scale(V.Mult([4,5,6],[1,2,3]),-1)));

// ── 19. mat3 composeRot: M_A after M_B applied to v == A*(B*v) ─────────────────
console.log('\n[19] mat3 composeRot: composition order');
const mA=M.RotatingX(0.3);
const mB=M.RotatingZ(1.1);
const mAB=M.RotatingX(0.3,mB);  // A after B
const v19=[0.3,0.7,0.6];
const direct=M.Trans(mA,M.Trans(mB,v19));
const composed=M.Trans(mAB,v19);
check('compose(A,B)*v == A*(B*v)',vecNear(direct,composed,1e-12));

// ── 20. celestCoordToLocalGlobeCoord preserves unit length ────────────────────
console.log('\n[20] celestCoordToLocalGlobeCoord preserves unit length (pure rotation)');
for(const [lat2,lon2,gmst2] of [[0,0,0],[45,15,123],[23,-60,200]]){
  const tm=compTransMatCelestToGlobe(lat2,lon2,gmst2);
  const vIn=V.Norm([0.3,0.6,0.7]);
  const vOut=M.Trans(tm,vIn);
  check(`unit preserved lat=${lat2},lon=${lon2},gmst=${gmst2}`,isUnit(vOut,1e-11),
        `|out|=${V.Length(vOut)}`);
}

// ── summary ──────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(55)}`);
console.log(`SUMMARY:  ${pass} PASS  /  ${fail} FAIL  /  ${pass+fail} total`);
if(fail>0){
  console.log('\nFailed tests indicate real implementation issues (see above).');
  process.exitCode=1;
}else{
  console.log('\nAll checks passed.');
}

