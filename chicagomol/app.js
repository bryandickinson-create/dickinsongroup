'use strict';
/* ---------- math ---------- */
const TAU = Math.PI * 2;
function mulberry(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
const vsub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const vadd=(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
const vmul=(a,s)=>[a[0]*s,a[1]*s,a[2]*s];
const vdot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const vcross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const vlen=a=>Math.hypot(a[0],a[1],a[2]);
const vnorm=a=>{const l=vlen(a)||1;return [a[0]/l,a[1]/l,a[2]/l]};
const dist=(a,b)=>vlen(vsub(a,b));

/* ---------- parsing ---------- */
function parseStructure(text){
  const lines=text.split(/\r?\n/);
  let atoms=[],helix=[],sheet=[];
  if(/^_atom_site\./m.test(text)){
    atoms=parseCIFAtoms(lines);
  } else {
    for(const l of lines){
      const rec=l.substr(0,6);
      if(rec==='ATOM  '){
        if(l.substr(12,4)!==' CA ')continue;
        const alt=l[16];if(alt!==' '&&alt!=='A')continue;
        atoms.push({ch:l[21],rn:parseInt(l.substr(22,4)),p:[+l.substr(30,8),+l.substr(38,8),+l.substr(46,8)]});
      } else if(rec==='HELIX ')helix.push([l[19],parseInt(l.substr(21,4)),parseInt(l.substr(33,4))]);
      else if(rec==='SHEET ')sheet.push([l[21],parseInt(l.substr(22,4)),parseInt(l.substr(33,4))]);
      else if(rec==='ENDMDL')break;
    }
  }
  const byCh=new Map();
  for(const a of atoms){if(!byCh.has(a.ch))byCh.set(a.ch,[]);byCh.get(a.ch).push(a)}
  const chains=[];
  for(const [ch,arr] of byCh){
    let cur=[];
    const flush=()=>{if(cur.length>=4)chains.push(finishChain(ch,cur,helix,sheet));cur=[]};
    for(const a of arr){
      if(cur.length&&dist(cur[cur.length-1].p,a.p)>5.2)flush();
      cur.push(a);
    }
    flush();
  }
  if(!chains.length)throw new Error('No C-alpha atoms found');
  return chains;
}
function parseCIFAtoms(lines){
  const out=[];let cols=null,inLoop=false,model=null;
  for(let i=0;i<lines.length;i++){
    const l=lines[i];
    if(!cols){
      if(l.startsWith('loop_')){
        let j=i+1;const h=[];
        while(j<lines.length&&lines[j].startsWith('_atom_site.')){h.push(lines[j].trim());j++}
        if(h.length){cols={};h.forEach((n,k)=>cols[n.slice(11)]=k);i=j-1;inLoop=true}
      }
      continue;
    }
    if(l.startsWith('#')||l.startsWith('loop_')||l.startsWith('_'))break;
    const t=l.trim().split(/\s+/);if(t.length<h0(cols))continue;
    if(t[cols.group_PDB]!=='ATOM')continue;
    const an=(t[cols.label_atom_id]||'').replace(/"/g,'');if(an!=='CA')continue;
    const alt=t[cols.label_alt_id];if(alt!=='.'&&alt!=='A')continue;
    if(cols.pdbx_PDB_model_num!==undefined){const m=t[cols.pdbx_PDB_model_num];if(model===null)model=m;if(m!==model)continue}
    const ch=t[cols.auth_asym_id!==undefined?cols.auth_asym_id:cols.label_asym_id];
    const rn=parseInt(t[cols.auth_seq_id!==undefined?cols.auth_seq_id:cols.label_seq_id]);
    out.push({ch,rn,p:[+t[cols.Cartn_x],+t[cols.Cartn_y],+t[cols.Cartn_z]]});
  }
  return out;
}
function h0(c){return Math.max(c.Cartn_x,c.Cartn_y,c.Cartn_z)+1}
function finishChain(ch,atoms,helix,sheet){
  const pts=atoms.map(a=>a.p);
  let ss=null;
  if(helix.length||sheet.length){
    ss=atoms.map(a=>{
      for(const h of helix)if(h[0]===ch&&a.rn>=h[1]&&a.rn<=h[2])return 1;
      for(const h of sheet)if(h[0]===ch&&a.rn>=h[1]&&a.rn<=h[2])return 2;
      return 0;
    });
  } else ss=geoSS(pts);
  return {pts,ss:cleanSS(ss)};
}
function geoSS(pts){
  const n=pts.length,ss=new Array(n).fill(0);
  for(let i=0;i+4<n;i++){
    const d3=dist(pts[i],pts[i+3]),d4=dist(pts[i],pts[i+4]);
    if(d3>4.4&&d3<5.8&&d4>5.3&&d4<6.9)for(let j=i;j<=i+4;j++)ss[j]=1;
  }
  for(let i=0;i+3<n;i++){
    const d2=dist(pts[i],pts[i+2]),d3=dist(pts[i],pts[i+3]);
    if(d2>6.0&&d3>8.8)for(let j=i;j<=i+3;j++)if(ss[j]===0)ss[j]=2;
  }
  return ss;
}
function cleanSS(ss){
  const n=ss.length;let i=0;
  while(i<n){let j=i;while(j<n&&ss[j]===ss[i])j++;
    const min=ss[i]===1?4:ss[i]===2?3:0;
    if(ss[i]&&j-i<min)for(let k=i;k<j;k++)ss[k]=0;
    i=j;}
  return ss;
}

/* ---------- demo protein: procedural TIM barrel ---------- */
function demoProtein(){
  const pts=[],ss=[];const N=8;
  const put=(p,s)=>{pts.push(p);ss.push(s)};
  for(let i=0;i<N;i++){
    const th=i*TAU/N,th2=th+TAU/N/2,th3=th+TAU/N;
    for(let j=0;j<8;j++){const a=th+j*0.018;put([7*Math.cos(a),7*Math.sin(a),-12+j*3.3],2)}
    const a1=th+0.15;
    put([10*Math.cos(a1),10*Math.sin(a1),16.5],0);
    put([12.5*Math.cos(th2),12.5*Math.sin(th2),17],0);
    const r=[Math.cos(th2),Math.sin(th2),0],t=[-Math.sin(th2),Math.cos(th2),0];
    for(let j=0;j<22;j++){
      const z=14-j*1.5,a=j*1.745;
      const c=[14*r[0],14*r[1],z];
      put([c[0]+2.3*(Math.cos(a)*r[0]+Math.sin(a)*t[0]),c[1]+2.3*(Math.cos(a)*r[1]+Math.sin(a)*t[1]),z],1);
    }
    put([12.5*Math.cos(th2+0.1),12.5*Math.sin(th2+0.1),-16],0);
    put([9*Math.cos(th3-0.1),9*Math.sin(th3-0.1),-15.5],0);
  }
  return [{pts,ss}];
}

/* ---------- geometry: spline + ribbon frames ---------- */
const SUB=8;
function buildGeometry(chains){
  const all=[];chains.forEach(c=>c.pts.forEach(p=>all.push(p)));
  const cen=[0,0,0];all.forEach(p=>{cen[0]+=p[0];cen[1]+=p[1];cen[2]+=p[2]});
  cen[0]/=all.length;cen[1]/=all.length;cen[2]/=all.length;
  const geos=[];let R=1;
  for(const c of chains){
    const P=c.pts.map(p=>vsub(p,cen)),n=P.length;
    const Q=[],S=[],Wd=[],Cap=[];
    // strand run ends
    const runEnd=new Array(n).fill(-1);
    {let i=0;while(i<n){let j=i;while(j<n&&c.ss[j]===c.ss[i])j++;if(c.ss[i]===2)for(let k=i;k<j;k++)runEnd[k]=j-1;i=j}}
    const g=(i)=>P[Math.max(0,Math.min(n-1,i))];
    for(let i=0;i<n-1;i++){
      for(let s=0;s<SUB;s++){
        const t=s/SUB,t2=t*t,t3=t2*t;
        const p0=g(i-1),p1=g(i),p2=g(i+1),p3=g(i+2);
        const q=[0,1,2].map(k=>0.5*((2*p1[k])+(-p0[k]+p2[k])*t+(2*p0[k]-5*p1[k]+4*p2[k]-p3[k])*t2+(-p0[k]+3*p1[k]-3*p2[k]+p3[k])*t3));
        const ssv=t<0.5?c.ss[i]:c.ss[i+1];
        let w=ssv===1?1.7:ssv===2?1.25:0.3,cap=false;
        if(ssv===2){const e=runEnd[t<0.5?i:i+1],u=i+t;if(e>=0&&u>e-1){w=Math.max(0.02,2.2*(e-u));}if(e>=0&&Math.abs(u-(e-1))<1e-6)cap=true;}
        Q.push(q);S.push(ssv);Wd.push(w);Cap.push(cap);
      }
    }
    Q.push(P[n-1]);S.push(c.ss[n-1]);Wd.push(0.3);Cap.push(false);
    const M=Q.length;
    const T=[],B=[];
    for(let k=0;k<M;k++){
      T.push(vnorm(vsub(Q[Math.min(M-1,k+1)],Q[Math.max(0,k-1)])));
    }
    let prev=null;
    for(let k=0;k<M;k++){
      const a=Q[Math.max(0,k-1)],b=Q[k],cc=Q[Math.min(M-1,k+1)];
      let N=vsub(vadd(a,cc),vmul(b,2));
      let bb=vcross(T[k],N);
      if(vlen(bb)<1e-7)bb=prev||vcross(T[k],Math.abs(T[k][0])<0.9?[1,0,0]:[0,1,0]);
      bb=vnorm(bb);
      if(prev&&vdot(bb,prev)<0)bb=vmul(bb,-1);
      B.push(bb);prev=bb;
    }
    const Bs=B.map((_,k)=>{let a=[0,0,0],cnt=0;for(let d=-5;d<=5;d++){const j=k+d;if(j<0||j>=M)continue;a=vadd(a,B[j]);cnt++}return vnorm(a)});
    for(const p of Q){R=Math.max(R,vlen(p)+2)}
    geos.push({Q,S,W:Wd,Cap,B:Bs});
  }
  return {geos,R};
}

/* ---------- projection ---------- */
function project(geo,view,W,H){
  const {yaw,pitch,zoom}=view;
  const cy=Math.cos(yaw),sy=Math.sin(yaw),cp=Math.cos(pitch),sp=Math.sin(pitch);
  const R=geo.R,scale=Math.min(W,H)*0.40/R*zoom,D=R*5;
  const rot=p=>{const x=p[0]*cy+p[2]*sy,z=-p[0]*sy+p[2]*cy,y=p[1];return [x,y*cp-z*sp,y*sp+z*cp]};
  const scr=q=>{const f=D/(D-q[2]);return [W/2+q[0]*scale*f,H/2-q[1]*scale*f,f]};
  const items=[],chains=[];let zmin=1e9,zmax=-1e9;
  const bounds={x0:1e9,x1:-1e9,y0:1e9,y1:-1e9};
  geo.geos.forEach((g,ci)=>{
    const M=g.Q.length,C=[],Lp=[],Rp=[],Z=[];
    for(let k=0;k<M;k++){
      const q=rot(g.Q[k]),b=rot(g.B[k]),w=g.W[k];
      C.push(scr(q));
      Lp.push(scr([q[0]+b[0]*w,q[1]+b[1]*w,q[2]+b[2]*w]));
      Rp.push(scr([q[0]-b[0]*w,q[1]-b[1]*w,q[2]-b[2]*w]));
      Z.push(q[2]);
      bounds.x0=Math.min(bounds.x0,C[k][0]);bounds.x1=Math.max(bounds.x1,C[k][0]);
      bounds.y0=Math.min(bounds.y0,C[k][1]);bounds.y1=Math.max(bounds.y1,C[k][1]);
    }
    chains.push({C,S:g.S,Z});
    let k=0;
    while(k<M-1){
      if(g.S[k]===0){
        let j=k;while(j<M-1&&g.S[j]===0&&j-k<SUB*40)j++;
        const pts=C.slice(k,j+1);let z=0,f=0;pts.forEach((p,i)=>{z+=Z[k+i];f+=p[2]});
        items.push({type:'tube',pts,z:z/pts.length,cw:0.62*scale*f/pts.length,ss:0,panel:ci*100000+k,ci});
        k=j;
      } else {
        const z=(Z[k]+Z[k+1])/2;
        items.push({type:'rib',ss:g.S[k],z,l0:Lp[k],l1:Lp[k+1],r1:Rp[k+1],r0:Rp[k],c0:C[k],c1:C[k+1],
          panel:ci*100000+Math.floor(k/10),first:k%10===0,cap:g.Cap[k],ci,k});
        k++;
      }
    }
    for(const z of Z){zmin=Math.min(zmin,z);zmax=Math.max(zmax,z)}
  });
  const zr=(zmax-zmin)||1;
  items.forEach(s=>{s.dn=(s.z-zmin)/zr});
  items.sort((a,b)=>a.z-b.z);
  return {items,chains,scale,bounds,W,H,zmin,zmax,zr};
}

/* ---------- drawing helpers ---------- */
function qpath(ctx,s){ctx.beginPath();ctx.moveTo(s.l0[0],s.l0[1]);ctx.lineTo(s.l1[0],s.l1[1]);ctx.lineTo(s.r1[0],s.r1[1]);ctx.lineTo(s.r0[0],s.r0[1]);ctx.closePath()}
function ribbon(ctx,s,fill,edge,ew,cross){
  qpath(ctx,s);ctx.fillStyle=fill;ctx.fill();
  ctx.strokeStyle=typeof fill==='string'?fill:'rgba(0,0,0,0)';ctx.lineWidth=1;ctx.lineJoin='round';ctx.stroke();
  if(edge){
    ctx.strokeStyle=edge;ctx.lineWidth=ew;ctx.lineCap='round';ctx.lineJoin='round';ctx.beginPath();
    ctx.moveTo(s.l0[0],s.l0[1]);ctx.lineTo(s.l1[0],s.l1[1]);
    ctx.moveTo(s.r0[0],s.r0[1]);ctx.lineTo(s.r1[0],s.r1[1]);
    if(cross){ctx.moveTo(s.l0[0],s.l0[1]);ctx.lineTo(s.r0[0],s.r0[1])}
    ctx.stroke();
  }
}
function tpath(ctx,s){ctx.beginPath();s.pts.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]))}
function tube(ctx,s,w,color){tpath(ctx,s);ctx.strokeStyle=color;ctx.lineWidth=w;ctx.lineCap='round';ctx.lineJoin='round';ctx.stroke()}
function hash(n){let x=Math.sin(n*127.1+311.7)*43758.5453;return x-Math.floor(x)}
function pick(arr,n){return arr[Math.floor(hash(n)*arr.length)]}
function hsl(h,s,l){s/=100;l/=100;const k=n=>(n+h/30)%12,a=s*Math.min(l,1-l),f=n=>l-a*Math.max(-1,Math.min(k(n)-3,Math.min(9-k(n),1)));return [f(0)*255,f(8)*255,f(4)*255]}
function star6(ctx,x,y,r){
  ctx.beginPath();
  for(let t=0;t<2;t++){for(let i=0;i<3;i++){const a=-Math.PI/2+(t?Math.PI/3:0)+i*TAU/3;const px=x+r*Math.cos(a),py=y+r*Math.sin(a);i?ctx.lineTo(px,py):ctx.moveTo(px,py)}ctx.closePath()}
  ctx.fill('nonzero');
}
function makeCanvas(w,h){
  if(typeof document!=='undefined'){const c=document.createElement('canvas');c.width=w;c.height=h;return c}
  return require('canvas').createCanvas(w,h);
}

/* ---------- stained-glass background ---------- */
const glassCache={};
function glassBG(W,H){
  const key=W+'x'+H;if(glassCache[key])return glassCache[key];
  const sc=2,w=Math.ceil(W/sc),h=Math.ceil(H/sc),cell=40,rnd=mulberry(11);
  const gx=Math.ceil(w/cell)+1,gy=Math.ceil(h/cell)+1,seeds=[];
  const hues=[0,18,38,48,130,165,205,225,275,320];
  for(let y=0;y<gy;y++)for(let x=0;x<gx;x++){
    const hu=hues[Math.floor(rnd()*hues.length)];
    seeds.push({x:(x+0.2+0.6*rnd())*cell,y:(y+0.2+0.6*rnd())*cell,c:hsl(hu,50,22+rnd()*14)});
  }
  const lab=new Int32Array(w*h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const cx=Math.floor(x/cell),cy=Math.floor(y/cell);let best=1e9,bi=0;
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
      const X=cx+dx,Y=cy+dy;if(X<0||Y<0||X>=gx||Y>=gy)continue;
      const s=seeds[Y*gx+X],d=(s.x-x)**2+(s.y-y)**2;if(d<best){best=d;bi=Y*gx+X}
    }
    lab[y*w+x]=bi;
  }
  const cv=makeCanvas(w,h),cx=cv.getContext('2d'),img=cx.createImageData(w,h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const i=y*w+x,l=lab[i],s=seeds[l];
    const lead=(x+1<w&&lab[i+1]!==l)||(y+1<h&&lab[i+w]!==l);
    const d=Math.sqrt((s.x-x)**2+(s.y-y)**2),f=1.12-d/cell*0.5;
    const o=i*4;
    if(lead){img.data[o]=12;img.data[o+1]=10;img.data[o+2]=9}
    else{img.data[o]=Math.min(255,s.c[0]*f);img.data[o+1]=Math.min(255,s.c[1]*f);img.data[o+2]=Math.min(255,s.c[2]*f)}
    img.data[o+3]=255;
  }
  cx.putImageData(img,0,0);
  return glassCache[key]=cv;
}

/* ---------- skyline for the Bean ---------- */
function skyline(ctx,W,H){
  const sky=ctx.createLinearGradient(0,0,0,H*0.72);
  sky.addColorStop(0,'#5fa8e8');sky.addColorStop(1,'#dcefff');
  ctx.fillStyle=sky;ctx.fillRect(0,0,W,H);
  const rnd=mulberry(5);let x=-10;
  while(x<W){
    const bw=24+rnd()*56,bh=H*(0.16+rnd()*0.34);
    ctx.fillStyle=`rgb(${40+rnd()*20|0},${52+rnd()*22|0},${68+rnd()*24|0})`;
    ctx.fillRect(x,H*0.78-bh,bw,bh);
    ctx.fillStyle='rgba(255,230,160,0.5)';
    for(let wy=H*0.78-bh+8;wy<H*0.76;wy+=14)for(let wx=x+5;wx<x+bw-6;wx+=10)if(rnd()<0.35)ctx.fillRect(wx,wy,4,6);
    x+=bw+2;
  }
  const gr=ctx.createLinearGradient(0,H*0.78,0,H);
  gr.addColorStop(0,'#8d9299');gr.addColorStop(1,'#cfc9bd');
  ctx.fillStyle=gr;ctx.fillRect(0,H*0.78,W,H*0.22);
}

/* ---------- styles ---------- */
const LEAD='#0d0b0a';
const STYLES=[
{ id:'glass', name:'Stained Glass',
  bg(ctx,fr){ctx.drawImage(glassBG(fr.W,fr.H),0,0,fr.W,fr.H);
    ctx.strokeStyle=LEAD;ctx.lineWidth=14;ctx.strokeRect(0,0,fr.W,fr.H);},
  rib(ctx,s){
    const pal=s.ss===1?['#c1272d','#e0561f','#c2306f','#e8793a']:['#1f62b5','#1b93a8','#3a46b0','#2a7fd0'];
    const c=pick(pal,s.panel);
    const sh=0.75+0.35*s.dn;
    ribbon(ctx,s,shade(c,sh),LEAD,3.2,s.first||s.cap);
    ctx.strokeStyle='rgba(255,255,255,0.22)';ctx.lineWidth=1.5;ctx.beginPath();
    ctx.moveTo(s.c0[0],s.c0[1]);ctx.lineTo(s.c1[0],s.c1[1]);ctx.stroke();
  },
  tube(ctx,s){tube(ctx,s,s.cw+4,LEAD);tube(ctx,s,s.cw,shade('#efb93a',0.7+0.4*s.dn))}
},
{ id:'flag', name:'Chicago Flag',
  bg(ctx,fr){const {W,H}=fr;ctx.fillStyle='#ffffff';ctx.fillRect(0,0,W,H);
    ctx.fillStyle='#41B6E6';ctx.fillRect(0,H/6,W,H/6);ctx.fillRect(0,H*4/6,W,H/6);
    ctx.fillStyle='#B3282D';[0.2,0.4,0.6,0.8].forEach(x=>star6(ctx,W*x,H/2,Math.min(W,H)*0.07));},
  rib(ctx,s){const fill=s.ss===1?'#41B6E6':'#B3282D',edge=s.ss===1?'#12597a':'#6d1217';ribbon(ctx,s,fill,edge,2,s.first||s.cap)},
  tube(ctx,s){tube(ctx,s,s.cw+3,'#ffffff');tube(ctx,s,s.cw,'#18242f')}
},
{ id:'prairie', name:'Prairie School',
  bg(ctx,fr){const {W,H}=fr;ctx.fillStyle='#ece1c4';ctx.fillRect(0,0,W,H);
    ctx.strokeStyle='rgba(120,90,50,0.18)';ctx.lineWidth=1;
    for(let y=0;y<H;y+=14){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke()}
    ctx.fillStyle='#6b4226';ctx.fillRect(0,H*0.93,W,H*0.07);
    ctx.fillStyle='#d9a441';ctx.fillRect(0,H*0.93-6,W,6);
    ctx.strokeStyle='#2c2218';ctx.lineWidth=3;ctx.strokeRect(18,18,W-36,H-36);ctx.lineWidth=1;ctx.strokeRect(26,26,W-52,H-52);},
  rib(ctx,s){const fill=s.ss===1?'#b8532b':'#3d6b55';ribbon(ctx,s,shade(fill,0.85+0.25*s.dn),'#2c2218',2,s.first||s.cap);
    ctx.strokeStyle='#e3b049';ctx.lineWidth=2;ctx.lineCap='butt';ctx.beginPath();ctx.moveTo(s.c0[0],s.c0[1]);ctx.lineTo(s.c1[0],s.c1[1]);ctx.stroke()},
  tube(ctx,s){tube(ctx,s,s.cw+3,'#2c2218');tube(ctx,s,s.cw,'#d9a441')}
},
{ id:'deco', name:'Art Deco',
  bg(ctx,fr){const {W,H}=fr;const g=ctx.createLinearGradient(0,0,0,H);g.addColorStop(0,'#06060c');g.addColorStop(1,'#1b1633');
    ctx.fillStyle=g;ctx.fillRect(0,0,W,H);
    const cx=W/2,cy=H*1.02,n=28;
    for(let i=0;i<n;i++){const a0=Math.PI+i*Math.PI/n,a1=a0+Math.PI/n/2,r=Math.hypot(W,H);
      ctx.fillStyle='rgba(212,175,55,0.07)';ctx.beginPath();ctx.moveTo(cx,cy);ctx.lineTo(cx+r*Math.cos(a0),cy+r*Math.sin(a0));ctx.lineTo(cx+r*Math.cos(a1),cy+r*Math.sin(a1));ctx.fill()}
    ctx.strokeStyle='#d4af37';ctx.lineWidth=3;ctx.strokeRect(16,16,W-32,H-32);ctx.lineWidth=1;ctx.strokeRect(24,24,W-48,H-48);},
  rib(ctx,s){const g=ctx.createLinearGradient(s.l0[0],s.l0[1],s.r0[0],s.r0[1]);
    const a=0.6+0.4*s.dn;g.addColorStop(0,shade('#f6df8e',a));g.addColorStop(0.5,shade('#c99a2e',a));g.addColorStop(1,shade('#6f5114',a));
    ribbon(ctx,s,g,'#1a1304',1.5,s.first||s.cap);
    ctx.strokeStyle='rgba(255,246,210,0.7)';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(s.c0[0],s.c0[1]);ctx.lineTo(s.c1[0],s.c1[1]);ctx.stroke()},
  tube(ctx,s){tube(ctx,s,s.cw+2.5,'#1a1304');tube(ctx,s,s.cw,shade('#e8c765',0.7+0.35*s.dn))}
},
{ id:'lmap', name:'The L',
  bg(ctx,fr){ctx.fillStyle='#f4f1e8';ctx.fillRect(0,0,fr.W,fr.H)},
  custom(ctx,fr){
    const {W,H}=fr,g=Math.max(10,fr.scale*1.6);
    const runs=[];
    fr.chains.forEach(ch=>{
      let k=0;const M=ch.C.length;
      while(k<M){let j=k;while(j<M&&ch.S[j]===ch.S[k])j++;
        const step=ch.S[k]===1?SUB*3:SUB>>1,idx=[];
        for(let q=k;q<Math.min(M,j+1);q+=step)idx.push(q);
        if(idx[idx.length-1]!==Math.min(M-1,j))idx.push(Math.min(M-1,j));
        let z=0;idx.forEach(q=>z+=ch.Z[Math.min(q,M-1)]);
        const sm=q=>{q=Math.min(q,M-1);if(ch.S[k]!==1)return ch.C[q];
          let x=0,y=0,n=0;for(let d=-14;d<=14;d++){const p=q+d;if(p<k||p>Math.min(M-1,j))continue;x+=ch.C[p][0];y+=ch.C[p][1];n++}return [x/n,y/n]};
        runs.push({ss:ch.S[k],pts:idx.map(q=>{const c=sm(q);return [Math.round((c[0]-W/2)/g)*g+W/2,Math.round((c[1]-H/2)/g)*g+H/2]}),z:z/idx.length});
        k=j;}
    });
    runs.sort((a,b)=>a.z-b.z);
    const col={1:'#c60c30',2:'#00a1de',0:'#62361b'};
    const path=pts=>{ctx.beginPath();ctx.moveTo(pts[0][0],pts[0][1]);
      for(let i=1;i<pts.length;i++){const a=pts[i-1],b=pts[i],dx=b[0]-a[0],dy=b[1]-a[1],ax=Math.abs(dx),ay=Math.abs(dy);
        if(ax>ay)ctx.lineTo(b[0]-Math.sign(dx)*ay,a[1]);else ctx.lineTo(a[0],b[1]-Math.sign(dy)*ax);
        ctx.lineTo(b[0],b[1]);}};
    const lw=Math.max(5,g*0.5);
    runs.forEach(r=>{path(r.pts);ctx.strokeStyle='#f4f1e8';ctx.lineWidth=lw+5;ctx.lineCap='round';ctx.lineJoin='round';ctx.stroke();
      path(r.pts);ctx.strokeStyle=col[r.ss];ctx.lineWidth=lw;ctx.stroke();});
    runs.forEach(r=>{if(r.ss&&r.pts.length>2){const m=r.pts[r.pts.length>>1];
      ctx.beginPath();ctx.arc(m[0],m[1],lw*0.8,0,TAU);ctx.fillStyle='#fff';ctx.fill();ctx.lineWidth=3;ctx.strokeStyle='#111';ctx.stroke()}});
    ctx.fillStyle='#111';ctx.font='700 22px Helvetica, Arial, sans-serif';ctx.textAlign='left';ctx.fillText('THE PROTEIN L',34,50);
    [['#c60c30','Red Line  α-helix'],['#00a1de','Blue Line  β-strand'],['#62361b','Brown Line  loop']].forEach((e,i)=>{
      ctx.fillStyle=e[0];ctx.fillRect(34,66+i*24,34,9);ctx.fillStyle='#111';ctx.font='13px Helvetica, Arial, sans-serif';ctx.fillText(e[1],78,76+i*24)});
  }
},
{ id:'maroon', name:'Maroon & Gothic',
  bg(ctx,fr){const {W,H}=fr;ctx.fillStyle='#f4eee1';ctx.fillRect(0,0,W,H);
    const cx=W/2,base=H*0.9,half=Math.min(W,H)*0.46,spring=H*0.45;
    ctx.strokeStyle='rgba(128,0,0,0.22)';ctx.lineWidth=3;
    for(let i=0;i<4;i++){const hw=half-i*half*0.16,sp=spring+i*half*0.12;
      ctx.beginPath();ctx.moveTo(cx-hw,base);ctx.lineTo(cx-hw,sp);
      ctx.arc(cx+hw,sp,2*hw,Math.PI,Math.PI+Math.acos(0.5),false);
      ctx.moveTo(cx+hw,base);ctx.lineTo(cx+hw,sp);
      ctx.arc(cx-hw,sp,2*hw,0,-Math.acos(0.5),true);ctx.stroke();}
    ctx.beginPath();ctx.moveTo(cx,base);ctx.lineTo(cx,spring-half*0.1);ctx.stroke();
    ctx.beginPath();ctx.arc(cx,spring-half*0.55,half*0.22,0,TAU);ctx.stroke();
    ctx.fillStyle='#800000';ctx.font='600 13px Georgia, serif';ctx.textAlign='center';
    ctx.fillText('C R E S C A T   S C I E N T I A   ·   V I T A   E X C O L A T U R',cx,H-26);
    ctx.fillRect(40,H-46,W-80,2);},
  rib(ctx,s){const fill=s.ss===1?'#800000':'#8b8c86';ribbon(ctx,s,shade(fill,0.8+0.3*s.dn),s.ss===1?'#3d0000':'#4a4b47',1.8,s.first||s.cap)},
  tube(ctx,s){tube(ctx,s,s.cw+2.5,'#2b2b2b');tube(ctx,s,s.cw,'#c9bfa8')}
},
{ id:'blueprint', name:'Burnham Blueprint',
  bg(ctx,fr){const {W,H}=fr;ctx.fillStyle='#0d3b7c';ctx.fillRect(0,0,W,H);
    for(let x=0;x<W;x+=20){ctx.strokeStyle=x%100===0?'rgba(255,255,255,0.2)':'rgba(255,255,255,0.07)';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke()}
    for(let y=0;y<H;y+=20){ctx.strokeStyle=y%100===0?'rgba(255,255,255,0.2)':'rgba(255,255,255,0.07)';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke()}},
  rib(ctx,s,fr){qpath(ctx,s);ctx.fillStyle=fr.plain?'rgba(13,59,124,0.07)':'rgba(180,215,255,0.07)';ctx.fill();
    ctx.strokeStyle=fr.ink;ctx.lineWidth=1.2;ctx.lineJoin='round';ctx.beginPath();
    ctx.moveTo(s.l0[0],s.l0[1]);ctx.lineTo(s.l1[0],s.l1[1]);ctx.moveTo(s.r0[0],s.r0[1]);ctx.lineTo(s.r1[0],s.r1[1]);
    if(s.first||s.cap){ctx.moveTo(s.l0[0],s.l0[1]);ctx.lineTo(s.r0[0],s.r0[1])}ctx.stroke();},
  tube(ctx,s,fr){tube(ctx,s,Math.max(1.5,s.cw*0.5),fr.ink)},
  post(ctx,fr){const {W,H,bounds:b}=fr;
    const y=Math.min(H-110,b.y1+30);ctx.strokeStyle=fr.ink;ctx.fillStyle=fr.ink;ctx.lineWidth=1;
    ctx.beginPath();ctx.moveTo(b.x0,y);ctx.lineTo(b.x1,y);ctx.moveTo(b.x0,y-6);ctx.lineTo(b.x0,y+6);ctx.moveTo(b.x1,y-6);ctx.lineTo(b.x1,y+6);ctx.stroke();
    ctx.font='12px "Courier New", monospace';ctx.textAlign='center';ctx.fillText(((b.x1-b.x0)/fr.scale).toFixed(1)+' Å',(b.x0+b.x1)/2,y-8);
    ctx.strokeStyle=fr.ink;ctx.lineWidth=2;ctx.strokeRect(W-250,H-84,226,60);ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(W-250,H-60);ctx.lineTo(W-24,H-60);ctx.stroke();
    ctx.textAlign='left';ctx.font='bold 12px "Courier New", monospace';ctx.fillText('PLAN OF A PROTEIN · SHEET 1',W-242,H-67);
    ctx.font='11px "Courier New", monospace';ctx.fillText('SCALE 1:1 Å   DRAWN: Cα TRACE',W-242,H-44);ctx.fillText('CHICAGO, ILL.',W-242,H-30);}
},
{ id:'bean', name:'Cloud Gate',
  bg(ctx,fr){skyline(ctx,fr.W,fr.H)},
  pre(ctx,fr){const g=ctx.createLinearGradient(0,fr.bounds.y0,0,fr.bounds.y1);
    [[0,'#bfe0ff'],[0.3,'#ffffff'],[0.48,'#7f93ad'],[0.6,'#1f2b3a'],[0.78,'#8b97a8'],[1,'#f0ebde']].forEach(e=>g.addColorStop(e[0],e[1]));fr.chrome=g},
  rib(ctx,s,fr){ribbon(ctx,s,fr.chrome,'rgba(10,20,35,0.45)',0.8,false);
    qpath(ctx,s);ctx.fillStyle=`rgba(15,25,45,${(1-s.dn)*0.45})`;ctx.fill()},
  tube(ctx,s,fr){tube(ctx,s,s.cw+1.5,'rgba(10,20,35,0.5)');tube(ctx,s,s.cw,fr.chrome);tube(ctx,s,s.cw,`rgba(15,25,45,${(1-s.dn)*0.4})`)}
},
{ id:'pilsen', name:'Pilsen Mural',
  bg(ctx,fr){const {W,H}=fr;
    const g=ctx.createLinearGradient(0,0,0,H);g.addColorStop(0,'#1aa5b8');g.addColorStop(0.55,'#f7b733');g.addColorStop(1,'#e2512d');
    ctx.fillStyle=g;ctx.fillRect(0,0,W,H);
    const sx=W/2,sy=H*0.62,r=Math.min(W,H)*0.2;
    for(let i=0;i<24;i++){const a0=i*TAU/24,a1=a0+TAU/48,R=Math.hypot(W,H);
      ctx.fillStyle=i%2?'rgba(255,240,170,0.28)':'rgba(226,81,45,0.18)';ctx.beginPath();ctx.moveTo(sx,sy);ctx.lineTo(sx+R*Math.cos(a0),sy+R*Math.sin(a0));ctx.lineTo(sx+R*Math.cos(a1),sy+R*Math.sin(a1));ctx.fill()}
    ctx.beginPath();ctx.arc(sx,sy,r,0,TAU);ctx.fillStyle='#ffd23f';ctx.fill();ctx.lineWidth=5;ctx.strokeStyle='#161212';ctx.stroke();
    ctx.fillStyle='#161212';for(let x=0;x<W;x+=26){ctx.beginPath();ctx.moveTo(x,H);ctx.lineTo(x+13,H-16);ctx.lineTo(x+26,H);ctx.fill()}
    const cols=['#e0307a','#ffd23f','#12b5b0','#7a3fb0','#ff7a1a'];
    ctx.strokeStyle='#161212';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(0,22);ctx.quadraticCurveTo(W/2,52,W,22);ctx.stroke();
    for(let i=0;i<Math.floor(W/46);i++){const x=14+i*46,t=x/W,yy=22+2*(1-t)*t*30;
      ctx.fillStyle=cols[i%cols.length];ctx.beginPath();ctx.moveTo(x,yy);ctx.lineTo(x+34,yy);ctx.lineTo(x+34,yy+30);ctx.lineTo(x+26,yy+24);ctx.lineTo(x+17,yy+30);ctx.lineTo(x+8,yy+24);ctx.lineTo(x,yy+30);ctx.closePath();ctx.fill();ctx.stroke()}},
  rib(ctx,s){const fill=s.ss===1?'#e0307a':'#12b5b0';ribbon(ctx,s,shade(fill,0.8+0.3*s.dn),'#161212',3.5,s.first||s.cap);
    ctx.fillStyle='rgba(255,255,255,0.8)';ctx.beginPath();ctx.arc((s.c0[0]+s.c1[0])/2,(s.c0[1]+s.c1[1])/2,1.8,0,TAU);ctx.fill()},
  tube(ctx,s){tube(ctx,s,s.cw+6,'#161212');tube(ctx,s,s.cw,'#ffd23f')}
},
{ id:'lake', name:'Lake Michigan',
  bg(ctx,fr){const {W,H}=fr,hz=H*0.64;
    const sk=ctx.createLinearGradient(0,0,0,hz);sk.addColorStop(0,'#1d2f6b');sk.addColorStop(0.55,'#c2527e');sk.addColorStop(0.85,'#ff9a5a');sk.addColorStop(1,'#ffd08a');
    ctx.fillStyle=sk;ctx.fillRect(0,0,W,hz);
    const wt=ctx.createLinearGradient(0,hz,0,H);wt.addColorStop(0,'#e58a6a');wt.addColorStop(0.25,'#3b6f9e');wt.addColorStop(1,'#0e2a52');
    ctx.fillStyle=wt;ctx.fillRect(0,hz,W,H-hz);
    ctx.save();ctx.beginPath();ctx.rect(0,0,W,hz);ctx.clip();ctx.beginPath();ctx.arc(W/2,hz-4,Math.min(W,H)*0.09,0,TAU);ctx.fillStyle='#fff1c4';ctx.fill();ctx.restore();
    const rnd=mulberry(9);
    for(let y=hz+6;y<H;y+=8){const k=(y-hz)/(H-hz),w=(30+k*160)*(0.5+rnd()),x=W/2+(rnd()-0.5)*(60+k*220)*(1-k*0.3);
      ctx.strokeStyle=`rgba(255,235,190,${0.55*(1-k)})`;ctx.lineWidth=1+k*2;ctx.beginPath();ctx.moveTo(x-w/2,y);ctx.lineTo(x+w/2,y);ctx.stroke()}
    for(let i=0;i<70;i++){const x=rnd()*W,y=hz+10+rnd()*(H-hz-10);ctx.strokeStyle='rgba(255,255,255,0.1)';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+14+rnd()*30,y);ctx.stroke()}},
  rib(ctx,s,fr){const fill=fr.plain?(s.ss===1?'#5f9fc2':'#e39a68'):(s.ss===1?'#e6f7fb':'#ffe0bc');ribbon(ctx,s,shade(fill,0.7+0.35*s.dn),'rgba(16,50,90,0.55)',1.2,s.first||s.cap)},
  tube(ctx,s,fr){tube(ctx,s,s.cw+2,'rgba(16,50,90,0.5)');tube(ctx,s,s.cw,shade(fr.plain?'#8cc0dc':'#ffffff',0.8+0.2*s.dn))}
},
{ id:'pizza', name:'Deep Dish',
  bg(ctx,fr){const {W,H}=fr;ctx.fillStyle='#f6efe2';ctx.fillRect(0,0,W,H);
    ctx.fillStyle='rgba(200,40,40,0.38)';const q=36;
    for(let y=0;y<H;y+=q)for(let x=0;x<W;x+=q){if(((x/q|0)+(y/q|0))%2===0)ctx.fillRect(x,y,q,q)}
    ctx.fillStyle='rgba(200,40,40,0.38)';for(let y=0;y<H;y+=q*2)ctx.fillRect(0,y,W,q);
    const cx=W/2,cy=H/2,r=Math.min(W,H)*0.44;
    ctx.beginPath();ctx.arc(cx+6,cy+10,r+8,0,TAU);ctx.fillStyle='rgba(0,0,0,0.25)';ctx.fill();
    const pan=ctx.createRadialGradient(cx,cy,r*0.8,cx,cy,r+6);pan.addColorStop(0,'#3a3a3d');pan.addColorStop(1,'#16161a');
    ctx.beginPath();ctx.arc(cx,cy,r+6,0,TAU);ctx.fillStyle=pan;ctx.fill();
    ctx.beginPath();ctx.arc(cx,cy,r-8,0,TAU);ctx.fillStyle='#b5321e';ctx.fill();
    ctx.strokeStyle='rgba(120,20,10,0.5)';ctx.lineWidth=2;
    for(let i=0;i<4;i++){ctx.beginPath();ctx.arc(cx,cy,r-24-i*r*0.2,0,TAU);ctx.stroke()}},
  rib(ctx,s){const fill=s.ss===1?'#f4c542':'#d63a22';ribbon(ctx,s,shade(fill,0.8+0.3*s.dn),s.ss===1?'#9a6b12':'#7d1a0e',1.8,s.first||s.cap)},
  tube(ctx,s){tube(ctx,s,s.cw+2.5,'#1f4d17');tube(ctx,s,s.cw,'#4f9a35')}
},
{ id:'phoenix', name:'Phoenix',
  bg(ctx,fr){const {W,H}=fr;
    const g=ctx.createLinearGradient(0,0,0,H);g.addColorStop(0,'#1a0305');g.addColorStop(1,'#6a0c10');ctx.fillStyle=g;ctx.fillRect(0,0,W,H);
    const rnd=mulberry(21);
    for(let layer=0;layer<3;layer++){
      const n=16-layer*3;
      for(let i=0;i<n;i++){
        const x=(i+0.5)*W/n+(rnd()-0.5)*30,h=H*(0.18+rnd()*0.3)*(1-layer*0.18),w=W/n*(0.9-layer*0.1);
        const fg=ctx.createLinearGradient(0,H-h,0,H);
        fg.addColorStop(0,layer===2?'rgba(255,235,150,0.85)':layer===1?'rgba(255,160,40,0.8)':'rgba(220,60,20,0.75)');
        fg.addColorStop(1,'rgba(120,10,10,0.0)');
        ctx.fillStyle=fg;ctx.beginPath();ctx.moveTo(x-w,H);
        ctx.bezierCurveTo(x-w*0.5,H-h*0.4,x+(rnd()-0.5)*w*0.6,H-h*0.7,x+(rnd()-0.5)*20,H-h);
        ctx.bezierCurveTo(x+w*0.1,H-h*0.6,x+w*0.5,H-h*0.35,x+w,H);ctx.fill();}}
    ctx.strokeStyle='rgba(255,215,120,0.55)';ctx.lineWidth=2;ctx.strokeRect(18,18,W-36,H-36);},
  rib(ctx,s){const g=ctx.createLinearGradient(s.l0[0],s.l0[1],s.r0[0],s.r0[1]);const a=0.6+0.4*s.dn;
    if(s.ss===1){g.addColorStop(0,shade('#ffe9a0',a));g.addColorStop(0.55,shade('#f5a02a',a));g.addColorStop(1,shade('#d1451a',a))}
    else{g.addColorStop(0,shade('#fff3c2',a));g.addColorStop(1,shade('#f0b640',a))}
    ribbon(ctx,s,g,'#2a0508',1.6,s.first||s.cap)},
  tube(ctx,s){tube(ctx,s,s.cw+2.5,'#2a0508');tube(ctx,s,s.cw,shade('#ffe9a0',0.7+0.35*s.dn))}
}
];
function shade(hex,f){
  const n=parseInt(hex.slice(1),16);let r=n>>16,g=n>>8&255,b=n&255;
  return `rgb(${Math.min(255,r*f)|0},${Math.min(255,g*f)|0},${Math.min(255,b*f)|0})`;
}

/* ---------- render ---------- */
function render(ctx,geo,view,W,H,style,opts){
  opts=opts||{};
  const fr=project(geo,view,W,H);
  fr.plain=!!opts.noBg;fr.ink=opts.noBg?'#0d3b7c':'#e6f0ff';
  if(!opts.noBg)style.bg(ctx,fr);
  else if(!opts.transparent){ctx.fillStyle='#ffffff';ctx.fillRect(0,0,W,H)}
  if(style.pre)style.pre(ctx,fr);
  if(style.custom)style.custom(ctx,fr);
  else for(const s of fr.items){if(s.type==='tube')style.tube(ctx,s,fr);else style.rib(ctx,s,fr)}
  if(style.post)style.post(ctx,fr);
}

/* ---------- TIFF + ZIP encoders ---------- */
function encodeTIFF(rgba,w,h){
  const n=w*h*4,cnt=11,ifdLen=2+cnt*12+4,bitsOff=8+ifdLen,dataOff=bitsOff+8;
  const buf=new ArrayBuffer(dataOff+n),dv=new DataView(buf);
  dv.setUint8(0,0x49);dv.setUint8(1,0x49);dv.setUint16(2,42,true);dv.setUint32(4,8,true);
  dv.setUint16(8,cnt,true);let p=10;
  const ent=(tag,type,count,val)=>{dv.setUint16(p,tag,true);dv.setUint16(p+2,type,true);dv.setUint32(p+4,count,true);
    if(type===3&&count===1)dv.setUint16(p+8,val,true);else dv.setUint32(p+8,val,true);p+=12};
  ent(256,4,1,w);ent(257,4,1,h);ent(258,3,4,bitsOff);ent(259,3,1,1);ent(262,3,1,2);ent(273,4,1,dataOff);
  ent(277,3,1,4);ent(278,4,1,h);ent(279,4,1,n);ent(284,3,1,1);ent(338,3,1,2);
  dv.setUint32(p,0,true);
  for(let i=0;i<4;i++)dv.setUint16(bitsOff+i*2,8,true);
  new Uint8Array(buf,dataOff).set(rgba);
  return new Uint8Array(buf);
}
function crc32(u8){
  let t=crc32.t;if(!t){t=crc32.t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c>>>0}}
  let crc=0xFFFFFFFF;for(let i=0;i<u8.length;i++)crc=t[(crc^u8[i])&255]^(crc>>>8);return (crc^0xFFFFFFFF)>>>0;
}
function zipStore(name,data){
  const nb=new TextEncoder().encode(name),crc=crc32(data),sz=data.length;
  const lh=30+nb.length,cd=46+nb.length,b=new Uint8Array(lh+sz+cd+22),dv=new DataView(b.buffer);
  dv.setUint32(0,0x04034b50,true);dv.setUint16(4,20,true);dv.setUint16(12,0x21,true);
  dv.setUint32(14,crc,true);dv.setUint32(18,sz,true);dv.setUint32(22,sz,true);dv.setUint16(26,nb.length,true);
  b.set(nb,30);b.set(data,lh);
  let o=lh+sz;
  dv.setUint32(o,0x02014b50,true);dv.setUint16(o+4,20,true);dv.setUint16(o+6,20,true);dv.setUint16(o+14,0x21,true);
  dv.setUint32(o+16,crc,true);dv.setUint32(o+20,sz,true);dv.setUint32(o+24,sz,true);dv.setUint16(o+28,nb.length,true);
  b.set(nb,o+46);o+=cd;
  dv.setUint32(o,0x06054b50,true);dv.setUint16(o+8,1,true);dv.setUint16(o+10,1,true);dv.setUint32(o+12,cd,true);dv.setUint32(o+16,lh+sz,true);
  return b;
}

/* ---------- UI ---------- */
if(typeof document!=='undefined'){
  const cv=document.getElementById('c'),ctx=cv.getContext('2d');
  const view={yaw:0.6,pitch:0.45,zoom:1};
  let noBg=false,geo=buildGeometry(demoProtein()),style=STYLES[0],W=0,H=0,spin=false,raf=0,label='TIM-barrel demo';
  const status=document.getElementById('status');
  function fit(){
    const dpr=window.devicePixelRatio||1;W=cv.clientWidth;H=cv.clientHeight;
    cv.width=W*dpr;cv.height=H*dpr;ctx.setTransform(dpr,0,0,dpr,0,0);draw();
  }
  function draw(){ctx.save();render(ctx,geo,view,W,H,style,{noBg});ctx.restore()}
  function loop(){if(!spin)return;view.yaw+=0.006;draw();raf=requestAnimationFrame(loop)}
  const chips=document.getElementById('chips');
  STYLES.forEach((s,i)=>{const b=document.createElement('button');b.textContent=s.name;if(!i)b.className='on';
    b.onclick=()=>{style=s;[...chips.children].forEach(c=>c.className='');b.className='on';draw()};chips.appendChild(b)});
  let drag=null;
  cv.addEventListener('pointerdown',e=>{drag=[e.clientX,e.clientY];cv.setPointerCapture(e.pointerId)});
  cv.addEventListener('pointermove',e=>{if(!drag)return;view.yaw+=(e.clientX-drag[0])*0.008;view.pitch=Math.max(-1.5,Math.min(1.5,view.pitch+(e.clientY-drag[1])*0.008));drag=[e.clientX,e.clientY];if(!spin)draw()});
  cv.addEventListener('pointerup',()=>drag=null);
  cv.addEventListener('wheel',e=>{e.preventDefault();view.zoom=Math.max(0.3,Math.min(4,view.zoom*Math.exp(-e.deltaY*0.001)));if(!spin)draw()},{passive:false});
  function load(text,name){
    try{geo=buildGeometry(parseStructure(text));label=name;status.textContent=name;draw()}
    catch(err){status.textContent='Could not read '+name+': '+err.message}
  }
  document.getElementById('file').onchange=e=>{const f=e.target.files[0];if(f)f.text().then(t=>load(t,f.name))};
  document.addEventListener('dragover',e=>e.preventDefault());
  document.addEventListener('drop',e=>{e.preventDefault();const f=e.dataTransfer.files[0];if(f)f.text().then(t=>load(t,f.name))});
  document.getElementById('spin').onclick=function(){spin=!spin;this.classList.toggle('on',spin);if(spin)loop();else cancelAnimationFrame(raf)};
  document.getElementById('bg').onclick=function(){noBg=!noBg;this.classList.toggle('on',noBg);this.textContent=noBg?'Show bg':'Hide bg';if(!spin)draw()};
  const ov=document.getElementById('ov'),img=document.getElementById('img'),tr=document.getElementById('tr'),msg=document.getElementById('msg');
  let dl=null,exportCv=null;
  if(window.claude&&claude.use)claude.use('downloads').then(d=>{dl=d;if(!d)document.getElementById('saves').style.display='none'}).catch(()=>{});
  function makeExport(){
    const S=2,oc=makeCanvas(W*S,H*S),o=oc.getContext('2d');o.scale(S,S);
    render(o,geo,view,W,H,style,{noBg,transparent:noBg&&tr.checked});exportCv=oc;img.src=oc.toDataURL('image/png');
  }
  document.getElementById('exp').onclick=()=>{tr.disabled=!noBg;if(!noBg)tr.checked=false;document.getElementById('trw').style.opacity=noBg?1:0.4;msg.textContent='';makeExport();ov.style.display='flex'};
  tr.onchange=makeExport;
  function note(t){msg.textContent=t}
  function fail(e){note(e&&e.code==='declined'?'Save cancelled.':'Could not save: '+((e&&e.message)||'unavailable here')+'. Right-click or long-press the image instead.')}
  document.getElementById('savepng').onclick=()=>{
    if(!dl||!exportCv)return;
    exportCv.toBlob(b=>dl.save({filename:'chicagomol-'+style.id+'.png',data:b}).then(()=>note('Saved PNG.')).catch(fail),'image/png');
  };
  document.getElementById('savetif').onclick=()=>{
    if(!dl||!exportCv)return;
    const w=exportCv.width,h=exportCv.height,px=exportCv.getContext('2d').getImageData(0,0,w,h).data;
    const zip=zipStore('chicagomol-'+style.id+'.tif',encodeTIFF(px,w,h));
    dl.save({filename:'chicagomol-'+style.id+'-tiff.zip',data:new Blob([zip])}).then(()=>note('Saved. Unzip to get the .tif.')).catch(fail);
  };
  document.getElementById('close').onclick=()=>ov.style.display='none';
  window.addEventListener('resize',fit);
  status.textContent=label+' · drop a PDB or mmCIF file';
  fit();
}
if(typeof module!=='undefined')module.exports={STYLES,buildGeometry,demoProtein,render,parseStructure,makeCanvas,encodeTIFF,zipStore};
