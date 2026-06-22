import { evaluate, helpers } from './smooth_eval.mjs';
const { normalizePoint, hav, angDiff } = helpers;
function resampleByArc(pts, ds){const P=[];for(const raw of pts){const p=normalizePoint(raw);if(p&&(!P.length||hav(P[P.length-1],p)>0.5))P.push(p);}if(P.length<2)return P;const out=[P[0]];let acc=0;for(let i=1;i<P.length;i++){let a=P[i-1],b=P[i];let segLen=hav(a,b);while(acc+segLen>=ds){const t=(ds-acc)/segLen;const np=[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];out.push(np);a=np;segLen=hav(a,b);acc=0;}acc+=segLen;}const last=P[P.length-1];if(hav(out[out.length-1],last)>ds*0.25)out.push(last);else out[out.length-1]=last;return out;}
function gauss(pts,window){const n=pts.length;if(n<3||window<3)return pts;const radius=Math.floor(window/2),sigma=radius/2||1;const out=new Array(n);for(let i=0;i<n;i++){if(i===0||i===n-1){out[i]=pts[i];continue;}const r=Math.min(radius,i,n-1-i);if(r<1){out[i]=pts[i];continue;}let sx=0,sy=0,sw=0;for(let k=-r;k<=r;k++){const w=Math.exp(-(k*k)/(2*sigma*sigma));sx+=pts[i+k][0]*w;sy+=pts[i+k][1]*w;sw+=w;}out[i]=[sx/sw,sy/sw];}return out;}
const DS=60,WIN=25,OUT=18,K=0.5;
const tf=s=>{let p=resampleByArc(s,DS);if(p.length<3)return p;p=gauss(p,WIN);p=resampleByArc(p,OUT);return p;};
const pace=legs=>{const w=new Array(legs.length).fill(1);for(let i=0;i<legs.length;i++){if(legs[i].bridge){w[i]=1;continue;}let j=i+1;while(j<legs.length&&legs[j].bridge)j++;let turn=0;if(j<legs.length)turn=angDiff(legs[i].heading,legs[j].heading);w[i]=legs[i].d*(1+K*Math.min(1,turn/90));}return w;};
const r=evaluate(tf,{name:'FINAL',pace});
console.log(JSON.stringify(r.summary,null,1));
console.log('density check: sample seg out/in ratios');
