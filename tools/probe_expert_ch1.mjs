import { helpers } from './smooth_eval.mjs';
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const { hav, normalizePoint, localProjector } = helpers;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const CH = JSON.parse(fs.readFileSync(path.resolve(HERE,'..','chapters_built.json'),'utf8')).chapters;

function projectorFor(pts){const lat0=pts.reduce((s,p)=>s+p[1],0)/pts.length;const kx=111320*Math.cos(lat0*Math.PI/180),ky=110540;return{to:p=>[p[0]*kx,p[1]*ky],back:q=>[q[0]/kx,q[1]/ky]};}
function perpDist(p,a,b){const vx=b[0]-a[0],vy=b[1]-a[1],wx=p[0]-a[0],wy=p[1]-a[1];const c2=vx*vx+vy*vy;if(c2<1e-12)return Math.hypot(wx,wy);let t=(vx*wx+vy*wy)/c2;t=Math.max(0,Math.min(1,t));return Math.hypot(p[0]-(a[0]+t*vx),p[1]-(a[1]+t*vy));}
function rdp(pts,eps){if(pts.length<3)return pts.slice();const keep=new Uint8Array(pts.length);keep[0]=1;keep[pts.length-1]=1;const st=[[0,pts.length-1]];while(st.length){const[i0,i1]=st.pop();let m=-1,idx=-1;for(let i=i0+1;i<i1;i++){const d=perpDist(pts[i],pts[i0],pts[i1]);if(d>m){m=d;idx=i;}}if(m>eps&&idx>0){keep[idx]=1;st.push([i0,idx],[idx,i1]);}}const o=[];for(let i=0;i<pts.length;i++)if(keep[i])o.push(pts[i]);return o;}
function catmullDense(P,stepM,longChordM){if(P.length<3)return P.slice();const at=i=>P[Math.max(0,Math.min(P.length-1,i))];const out=[];for(let i=0;i<P.length-1;i++){const p1=at(i),p2=at(i+1);const chord=Math.hypot(p2[0]-p1[0],p2[1]-p1[1]);const seg=Math.max(1,Math.min(60,Math.round(chord/stepM)));if(chord>longChordM){for(let s=0;s<seg;s++){const t=s/seg;out.push([p1[0]+(p2[0]-p1[0])*t,p1[1]+(p2[1]-p1[1])*t]);}}else{const p0=at(i-1),p3=at(i+2);for(let s=0;s<seg;s++){const t=s/seg,t2=t*t,t3=t2*t;out.push([0.5*((2*p1[0])+(-p0[0]+p2[0])*t+(2*p0[0]-5*p1[0]+4*p2[0]-p3[0])*t2+(-p0[0]+3*p1[0]-3*p2[0]+p3[0])*t3),0.5*((2*p1[1])+(-p0[1]+p2[1])*t+(2*p0[1]-5*p1[1]+4*p2[1]-p3[1])*t2+(-p0[1]+3*p1[1]-3*p2[1]+p3[1])*t3)]);}}}out.push(P[P.length-1]);return out;}

const ch = CH[1]; // 第一章
const rawSegs = (ch.segments||[]).map(s=>(s||[]).map(normalizePoint).filter(Boolean)).filter(s=>s.length>=2);
const refLat = (ch.stats?(ch.stats.latMin+ch.stats.latMax)/2:35);
const proj = localProjector(refLat);
const rawEdges=[]; for(const s of rawSegs){const pp=s.map(proj);for(let i=1;i<pp.length;i++)rawEdges.push([pp[i-1],pp[i]]);}
function distPointToSeg(p,a,b){const vx=b[0]-a[0],vy=b[1]-a[1],wx=p[0]-a[0],wy=p[1]-a[1];const c1=vx*wx+vy*wy;if(c1<=0)return Math.hypot(wx,wy);const c2=vx*vx+vy*vy;if(c2<=c1)return Math.hypot(p[0]-b[0],p[1]-b[1]);const t=c1/c2;return Math.hypot(p[0]-(a[0]+t*vx),p[1]-(a[1]+t*vy));}
function nearest(pp){let best=Infinity;for(const e of rawEdges){const d=distPointToSeg(pp,e[0],e[1]);if(d<best)best=d;}return best;}

// expert transform of each seg, find which processed point has biggest deviation, and whether nearest RAW point in SAME seg is also far (=> overlap artifact) or close (=> overshoot/distortion)
function smoothSeg(rawPts){const P=[];for(const raw of rawPts){const p=(Array.isArray(raw)&&Number.isFinite(+raw[0])&&Number.isFinite(+raw[1]))?[+raw[0],+raw[1]]:null;if(p&&(!P.length||hav(P[P.length-1],p)>1))P.push(p);}if(P.length<2)return{out:P,kept:P};const prj=projectorFor(P);const mp=P.map(prj.to);const simp=rdp(mp,12);if(simp.length<2)return{out:P,kept:P};const dense=catmullDense(simp,12,600);return{out:dense.map(prj.back),kept:simp.map(prj.back),cleaned:P};}

let worst={dev:-1};
rawSegs.forEach((s,si)=>{
  const {out, cleaned} = smoothSeg(s);
  // dist from each processed pt to nearest raw edge (global, same as eval)
  out.forEach(pt=>{
    const pp=proj(pt); const d=nearest(pp);
    if(d>worst.dev){
      // also: distance from this processed pt to the nearest CLEANED-input point of its OWN seg
      let selfMin=Infinity; for(const c of cleaned){const cd=Math.hypot(proj(pt)[0]-proj(c)[0],proj(pt)[1]-proj(c)[1]); if(cd<selfMin)selfMin=cd;}
      worst={dev:d, seg:si, pt, selfMin};
    }
  });
});
console.log('第一章 worst processed-point deviation from nearest raw edge:', worst.dev.toFixed(0),'m');
console.log('  in segment index:', worst.seg);
console.log('  distance from this point to nearest CLEANED point of its OWN segment:', worst.selfMin.toFixed(1),'m');
console.log('  -> if selfMin is small (<~30m), the point sits ON its own input geometry, so the 2013m');
console.log('     comes from the OVERLAP artifact (another trip passes near, eval matches wrong edge),');
console.log('     NOT from spline overshoot. If selfMin is large, it IS overshoot/distortion.');
