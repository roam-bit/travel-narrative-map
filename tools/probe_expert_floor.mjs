import { evaluate, helpers } from './smooth_eval.mjs';
const { hav } = helpers;
function projectorFor(pts){const lat0=pts.reduce((s,p)=>s+p[1],0)/pts.length;const kx=111320*Math.cos(lat0*Math.PI/180),ky=110540;return{to:p=>[p[0]*kx,p[1]*ky],back:q=>[q[0]/kx,q[1]/ky]};}
function perpDist(p,a,b){const vx=b[0]-a[0],vy=b[1]-a[1],wx=p[0]-a[0],wy=p[1]-a[1];const c2=vx*vx+vy*vy;if(c2<1e-12)return Math.hypot(wx,wy);let t=(vx*wx+vy*wy)/c2;t=Math.max(0,Math.min(1,t));return Math.hypot(p[0]-(a[0]+t*vx),p[1]-(a[1]+t*vy));}
function rdp(pts,eps){if(pts.length<3)return pts.slice();const keep=new Uint8Array(pts.length);keep[0]=1;keep[pts.length-1]=1;const st=[[0,pts.length-1]];while(st.length){const[i0,i1]=st.pop();let m=-1,idx=-1;for(let i=i0+1;i<i1;i++){const d=perpDist(pts[i],pts[i0],pts[i1]);if(d>m){m=d;idx=i;}}if(m>eps&&idx>0){keep[idx]=1;st.push([i0,idx],[idx,i1]);}}const o=[];for(let i=0;i<pts.length;i++)if(keep[i])o.push(pts[i]);return o;}
function catmullDense(P,stepM,longChordM){if(P.length<3)return P.slice();const at=i=>P[Math.max(0,Math.min(P.length-1,i))];const out=[];for(let i=0;i<P.length-1;i++){const p1=at(i),p2=at(i+1);const chord=Math.hypot(p2[0]-p1[0],p2[1]-p1[1]);const seg=Math.max(1,Math.min(60,Math.round(chord/stepM)));if(chord>longChordM){for(let s=0;s<seg;s++){const t=s/seg;out.push([p1[0]+(p2[0]-p1[0])*t,p1[1]+(p2[1]-p1[1])*t]);}}else{const p0=at(i-1),p3=at(i+2);for(let s=0;s<seg;s++){const t=s/seg,t2=t*t,t3=t2*t;out.push([0.5*((2*p1[0])+(-p0[0]+p2[0])*t+(2*p0[0]-5*p1[0]+4*p2[0]-p3[0])*t2+(-p0[0]+3*p1[0]-3*p2[0]+p3[0])*t3),0.5*((2*p1[1])+(-p0[1]+p2[1])*t+(2*p0[1]-5*p1[1]+4*p2[1]-p3[1])*t2+(-p0[1]+3*p1[1]-3*p2[1]+p3[1])*t3)]);}}}out.push(P[P.length-1]);return out;}
function smoothTrackSeg(rawPts){const P=[];for(const raw of rawPts){const p=(Array.isArray(raw)&&Number.isFinite(+raw[0])&&Number.isFinite(+raw[1]))?[+raw[0],+raw[1]]:null;if(p&&(!P.length||hav(P[P.length-1],p)>1))P.push(p);}if(P.length<2)return P;const prj=projectorFor(P);const mp=P.map(prj.to);const simp=rdp(mp,12);if(simp.length<2)return P;return catmullDense(simp,12,600).map(prj.back);}

const idRes = evaluate(s=>s.map(p=>p.slice()),{name:'identity'});
const exRes = evaluate(smoothTrackSeg,{name:'expert'});
// linear-only: dense straight resample between RDP-kept points (no spline overshoot at all)
function linearOnly(rawPts){const P=[];for(const raw of rawPts){const p=(Array.isArray(raw)&&Number.isFinite(+raw[0])&&Number.isFinite(+raw[1]))?[+raw[0],+raw[1]]:null;if(p&&(!P.length||hav(P[P.length-1],p)>1))P.push(p);}if(P.length<2)return P;const prj=projectorFor(P);const mp=P.map(prj.to);const out=[];for(let i=0;i<mp.length-1;i++){const p1=mp[i],p2=mp[i+1];const chord=Math.hypot(p2[0]-p1[0],p2[1]-p1[1]);const seg=Math.max(1,Math.round(chord/12));for(let s=0;s<seg;s++){const t=s/seg;out.push([p1[0]+(p2[0]-p1[0])*t,p1[1]+(p2[1]-p1[1])*t]);}}out.push(mp[mp.length-1]);return out.map(prj.back);}
const linRes = evaluate(linearOnly,{name:'linear-zerodev'});

console.log('per-chapter maxLatDevM (identity / expert / linear-zerodev):');
for(let i=0;i<idRes.rows.length;i++){
  const id=idRes.rows[i].maxLatDevM, ex=exRes.rows[i].maxLatDevM, ln=linRes.rows[i].maxLatDevM;
  const flag = ex > id+50 ? '  <-- expert WORSE than identity' : '';
  console.log(idRes.rows[i].name.padEnd(24),'id',String(id).padStart(6),'expert',String(ex).padStart(6),'linear',String(ln).padStart(6),flag);
}
console.log('\nWORST: identity',idRes.summary.worst_maxLatDevM,' linear',linRes.summary.worst_maxLatDevM,' expert',exRes.summary.worst_maxLatDevM);
console.log('\nlinear-zerodev full summary:',JSON.stringify(linRes.summary));
