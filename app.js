'use strict';

const VERSION = '1.0.1';
const tables = ['meal', 'exercise', 'body', 'pressure', 'condition', 'recipe', 'favorite'];
const clock = part => new Intl.DateTimeFormat('sv-SE', { timeZone:'Asia/Tokyo', ...(part === 'time' ? {hour:'2-digit', minute:'2-digit', hourCycle:'h23'} : {year:'numeric',month:'2-digit',day:'2-digit'}) }).format(new Date());
const today = () => clock('date');
const dayMs = date => Date.parse(date + 'T00:00:00Z');
const shift = (date, days) => new Date(dayMs(date) + days * 86400000).toISOString().slice(0,10);
const daysBetween = (a,b) => Math.round((dayMs(b)-dayMs(a))/86400000);
const validDate = date => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(dayMs(date)) && shift(date,0) === date;
const uid = () => globalThis.crypto?.randomUUID?.() ?? (Date.now().toString(36) + Math.random().toString(36).slice(2));
const empty = () => ({schema:1,started:today(),settings:{deadline:'2027-05-31',display:'表示',hints:true},offset:{},mode:{},plan:null,records:Object.fromEntries(tables.map(key=>[key,[]]))});
let state = empty();
let db, revision = null, ready = false, page = 'home', shownDay = today(), editing, timer;
const $ = id => document.getElementById(id);
const escape = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeURL = value => {try {const url=new URL(value);return ['https:','http:'].includes(url.protocol)&&!url.username&&!url.password?url.href:''}catch{return ''}};
const val = value => typeof value==='number' && Number.isFinite(value) ? value : null;
const rounded = value => Math.round(value*10)/10;
const signed = value => (value>0?'+':'') + rounded(value).toFixed(1);
const list = type => [...state.records[type]].sort((a,b)=>(b.date||'').localeCompare(a.date||'') || (b.time||'').localeCompare(a.time||''));
const at = (type,date=today()) => list(type).filter(row=>row.date===date);
const labels = {meal:'食事',exercise:'運動',body:'体重・サイズ',pressure:'血圧',condition:'体調',recipe:'食べたい料理',favorite:'お気に入り',settings:'目標と表示'};
const mealKinds = ['朝食','昼食','夕食','間食','飲み物'];
const modes = ['元気','少し疲れている','体調が悪い'];
const openDB = () => new Promise((resolve,reject)=>{
  const request=indexedDB.open('wellness-journal',1);
  request.onupgradeneeded=()=>request.result.createObjectStore('journal');
  request.onsuccess=()=>resolve(request.result);
  request.onerror=()=>reject(request.error);
});
const load = () => new Promise((resolve,reject)=>{
  const request=db.transaction('journal').objectStore('journal').get('data');
  request.onsuccess=()=>resolve(request.result);
  request.onerror=()=>reject(request.error);
});
function save(next) {
  if (!ready) return Promise.reject(new Error('端末内に保存できません。Safariの通常画面で開き直してください。'));
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('journal','readwrite');
    const store=tx.objectStore('journal');
    const read=store.get('data');
    const nextRevision=uid();
    let conflict=false;
    read.onsuccess=()=>{
      if ((read.result?.revision??null)!==revision) {
        conflict=true;
        tx.abort();
        return;
      }
      store.put({...next,revision:nextRevision},'data');
    };
    tx.oncomplete=()=>{revision=nextRevision;state=next;resolve()};
    tx.onabort=tx.onerror=()=>reject(new Error(conflict?'別の画面で手帳が更新されました。この画面を開き直してください。':'保存できませんでした。端末の空き容量をご確認ください。'));
  });
}
function message(text) {
  $('status').textContent=text;
  clearTimeout(timer);
  timer=setTimeout(()=>$('status').textContent='',4500);
}
function photo(value) {
  return typeof value==='string' && /^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/=]+$/i.test(value) ? value : '';
}
async function imageData(file) {
  if (!file?.size) return '';
  if (file.size > 35*1024*1024) throw new Error('写真は35MB以下にしてください。');
  const img = new Image();
  const url=URL.createObjectURL(file);
  try {
    await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(new Error('この写真を開けませんでした。JPEGやPNGを選んでください。'));img.src=url});
    const ratio=Math.min(1,1100/Math.max(img.naturalWidth,img.naturalHeight));
    const canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(img.naturalWidth*ratio));
    canvas.height=Math.max(1,Math.round(img.naturalHeight*ratio));
    canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
    return canvas.toDataURL('image/jpeg',.76);
  } finally {URL.revokeObjectURL(url)}
}
const workouts = [
  ['外を散歩','5〜15分','会話できるペースで近所を歩く。途中で引き返してもOK。','walk'],
  ['壁腕立て伏せ','6〜10回 × 1〜2','壁に両手を置き、体をまっすぐにしたまま肘をゆっくり曲げて戻す。','wall'],
  ['その場でダンス','好きな曲1〜3曲','腕を振り、小さなステップで。跳ばずに踊れる曲を選ぶ。','walk'],
  ['立ったままお腹を意識','左右6回 × 1〜2','壁に手を添え、息を吐きながら片足を小さく上げて下ろす。','walk'],
  ['椅子スクワット','6〜10回 × 1〜2','安定した椅子を壁際に置き、ゆっくり立って座る。','chair'],
  ['二の腕を伸ばす動き','左右6〜8回 × 1〜2','座って脇を締め、肘から先を後ろに伸ばして戻す。重りなしで始める。','chair'],
  ['その場で足踏み','1分ずつ、合計5〜10分','安定した台のそばで、小さく左右交互に足を上げる。','walk'],
  ['姿勢を整える','5分まで','椅子に座り、肩を軽く後ろへ引いてゆるめる。呼吸を止めない。','chair'],
  ['お腹に手を添えて呼吸','5分まで','楽な姿勢で座り、お腹に手を添え、息をゆっくり吐く。','chair']
];
const lightWorkouts = [
  ['座って足踏み','最大5分','椅子に座ったまま、足を交互に少し持ち上げる。','chair'],
  ['肩をゆっくり回す','前後に各4回','痛みが出ない範囲で肩を小さく回す。','chair'],
  ['足首をゆっくり動かす','左右各5回','椅子に座って、つま先を上げ下げする。','chair'],
  ['短い散歩','最大5分','外に出られる気分なら、ゆっくり歩く。','walk']
];
const restWorkouts = [
  ['今日は休養','運動はお休み','休むことも今日の達成です。','rest'],
  ['楽な姿勢でひと休み','1〜2分','無理のない姿勢でゆっくり呼吸。つらければそのまま休む。','rest']
];
const modeToday = () => state.mode[today()] || (at('condition')[0]?.back==='強い' || at('condition')[0]?.fatigue==='強い' ? modes[2] : at('condition')[0]?.fatigue==='少し' ? modes[1] : modes[0]);
function workout(date=today(),mode=modeToday(),offset=state.offset[date]||0) {
  const base=mode===modes[2]?restWorkouts:mode===modes[1]?lightWorkouts:workouts;
  const planned=state.plan?.days.find(item=>item.date===date)?.exercise;
  const sequence=planned && mode===modes[0] ? [[planned, '取り込んだ計画','その日の体調に合わせて短くして構いません。',''], ...base] : base;
  const start=sequence===base ? Math.floor(dayMs(date)/86400000) : 0;
  return sequence[(start+offset)%sequence.length];
}
function diagram(kind) {
  const shapes={walk:'M65 29L61 55L44 76M61 55L87 71M64 36L40 49M64 37L86 47',chair:'M69 29V55H94V78M69 39L86 51M42 45V56H68M48 56V78M67 56V78',wall:'M70 30L55 53L42 77M64 39L83 46L102 29M104 12V81',rest:'M32 64H112M58 57H102M36 52V78M108 64V78'};
  if (!shapes[kind]) return '';
  const heads={walk:[66,20],chair:[70,20],wall:[74,21],rest:[48,54]};
  const [x,y]=heads[kind];
  return '<svg class="diagram" viewBox="0 0 140 90" role="img" aria-label="'+escape(workout()[0])+'の姿勢の図"><circle cx="'+x+'" cy="'+y+'" r="7" fill="#a42b60"/><path d="'+shapes[kind]+'" stroke="#522137" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>';
}
const button=(text,action,value='',primary=false)=>'<button type="button" data-action="'+action+'" data-value="'+escape(value)+'"'+(primary?' class="primary"':'')+'>'+escape(text)+'</button>';
const box=(title,body,extra='')=>'<section class="tile '+extra+'"><h2>'+escape(title)+'</h2>'+body+'</section>';
const blank=text=>'<p class="muted">'+escape(text)+'</p>';
const tag=text=>'<span class="tag">'+escape(text)+'</span>';
const prettyDate=date=>new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',year:'numeric',month:'long',day:'numeric',weekday:'short'}).format(new Date(dayMs(date)));
function progress(home=false) {
  const s=state.settings;
  const latest=list('body').find(row=>val(row.weight)!==null)?.weight;
  const earliest=[...list('body')].reverse().find(row=>val(row.weight)!==null)?.weight;
  const base=s.baseline??earliest;
  const has=latest!=null && base!=null;
  const delta=has?latest-base:null;
  const pct=has&&s.target!=null&&base>s.target?(base-latest)/(base-s.target)*100:null;
  const remaining=daysBetween(today(),s.deadline);
  const display=s.display;
  return (home?'<p>'+escape(remaining>0?'目標日まで '+remaining+'日':remaining===0?'今日が目標日です':'目標日を過ぎました。これからも記録できます。')+'</p>':'')
    + (display==='表示'&&latest!=null?'<p class="metric">'+latest.toFixed(1)+' kg</p>':'')
    + (display!=='非表示'&&delta!=null?'<p>開始時から '+signed(delta)+' kg</p>':'')
    + (display!=='非表示'&&pct!=null?'<p>目標達成率 '+Math.round(Math.max(0,pct))+'%</p><progress aria-label="目標達成率" max="100" value="'+Math.min(100,Math.max(0,pct))+'"></progress>':'')
    + (display==='非表示'?'<p>体重の数字を隠しています。</p>':latest==null?'<p>体重は測れた日に記録しましょう。</p>':'')
    + (home?'<div class="actions">'+button('体重・サイズを記録','edit','body')+button('目標を設定','edit','settings')+'</div>':'');
}
function exercises() {
  const [name,dose,how,kind]=workout();
  const completed=at('exercise').filter(row=>row.source==='daily');
  const same=completed.some(row=>row.name===name && row.memo===dose);
  const recordLabel=same?(modeToday()===modes[2]?'休養をもう一度記録':'もう一度記録する')
    :modeToday()===modes[2]?'休養を記録':'完了を記録';
  return box('今日の運動','<label>今日の運動強度<select id="mode">'+modes.map(x=>'<option'+(x===modeToday()?' selected':'')+'>'+x+'</option>').join('')+'</select></label>'
  + (completed.length?'<p>'+tag('運動・休養の記録 '+completed.length+'件')+'</p>':'')+'<h3>'+escape(name)+'</h3><p>'+escape(dose)+'</p>'+diagram(kind)+'<p>'+escape(how)+'</p>'
  +'<div class="actions">'+button('別の運動にする','another')+button(recordLabel,'done','',true)+button('ダンス担当を記録','edit','dance')+'</div>');
}
const currentPlan = () => state.plan?.days.find(item=>item.date===today());
const mealPlan = item => '<ul>'+[['朝食','breakfast'],['昼食','lunch'],['夕食','dinner'],['間食','snack']].filter(([,key])=>item[key]).map(([title,key])=>'<li><b>'+title+'</b> '+escape(item[key])+'</li>').join('')+'</ul>';
function planIntro() {
  const end=shift(state.started,6);
  const count=new Set(list('meal').filter(row=>row.date>=state.started&&row.date<=end&&row.kind!=='飲み物').map(row=>row.date)).size;
  return today()<=end ? '<p>まずは普段どおりの7日間。食事を記録した日は <b>'+count+'日</b> です。</p>' : '<p>記録をもとに、来週の献立を作れます。</p>';
}
function mealHint() {
  if (!state.settings.hints) return '';
  const time=clock('time');
  const next=time>='18:00'?'夕食':time>='12:00'?'昼食':time>='08:00'?'朝食':'';
  return next&&!at('meal').some(row=>row.kind===next) ? '<p class="muted">'+next+'の記録がまだです。集中していたら、いったん食事の時間を確認しましょう。</p>' : '';
}
function home() {
  const condition=at('condition')[0];
  const movement=at('exercise').length;
  const mealCount=at('meal').filter(row=>row.kind!=='飲み物').length;
  return '<section class="hero"><p class="eyebrow">'+prettyDate(today())+'</p><h2>今日も、私のペースで。</h2>'+progress(true)+'</section>'
  + '<section class="tile"><h2>今日の記録</h2><div class="actions">'+button('食事を記録','edit','meal',true)+button('血圧を記録','edit','pressure',true)+button('体調を記録','edit','condition')+'</div>'
  +'<p>'+tag('食事 '+mealCount+'件')+' '+tag('運動・休養 '+movement+'件')+' '+tag('血圧 '+at('pressure').length+'件')+'</p>'
  +'<p>'+ (condition?'体調：疲労 '+escape(condition.fatigue||'—')+' ／ 背中 '+escape(condition.back||'—'):'今日の体調は未記録です。')+'</p>'+mealHint()
  +'<p>'+ (modeToday()===modes[2]?'今日は休むことも、手帳に残せる立派な選択です。':mealCount+movement?'今日の自分に気を配れましたね。':'できたことを一つだけ残す日があっても大丈夫。')+'</p></section>'
  +'<div class="grid">'+exercises()+box('今日のおすすめ献立',(currentPlan()?mealPlan(currentPlan()):planIntro())+button('7日間の献立へ','page','plan'))+'</div>';
}
const input = (label,key,type='text',extra='') => ({label,key,type,extra});
const select = (label,key,options,optional=false) => ({label,key,type:'select',options,optional});
const date = input('日付','date','date','required');
const time = input('時間','time','time','required');
const note = input('メモ','memo','textarea');
const picture = input('写真（任意）','photo','file','accept="image/*"');
const number = (label,key,min,max,step=1,required=false) => input(label,key,'number','min="'+min+'" max="'+max+'" step="'+step+'"'+(required?' required':''));
const schema = {
  meal:[date,select('食事の種類','kind',mealKinds),time,input('食べたもの・飲んだもの','name','text','required'),picture,note],
  exercise:[date,input('運動・活動','name','text','required'),number('時間（分、任意）','minutes',0,1440),note],
  body:[date,number('体重（kg）','weight',20,500,.1),number('ウエスト（cm）','waist',10,350,.1),number('左の二の腕（cm）','left',5,150,.1),number('右の二の腕（cm）','right',5,150,.1),note],
  pressure:[date,time,select('朝・夜','period',['朝','夜']),number('最高血圧（mmHg）','sys',1,350,1,true),number('最低血圧（mmHg）','dia',1,350,1,true),number('脈拍（回/分）','pulse',1,350),note],
  condition:[date,number('睡眠時間（時間）','sleep',0,24,.1),select('睡眠の質','sleepQuality',['よい','ふつう','悪い'],true),select('疲労感','fatigue',['なし','少し','強い'],true),select('気分','mood',['よい','ふつう','落ち込み気味','そわそわする'],true),select('食欲','appetite',['ある','ふつう','少ない'],true),select('空腹時の体調','hunger',['いつもどおり','少し不調','つらかった','空腹になる前に食べた'],true),select('背中の違和感','back',['なし','少し','強い'],true),select('便通','bowel',['あり','なし','気になる'],true),note],
  recipe:[input('料理名','name','text','required'),input('投稿・レシピURL','url','url'),picture,input('材料','ingredients','textarea'),input('作り方','method','textarea'),note,input('作りたい日','date','date'),input('作った','made','checkbox')],
  settings:[input('目標日','deadline','date','required'),number('開始時の体重（kg）','baseline',20,500,.1),number('目標体重（kg）','target',20,500,.1),select('体重の表示','display',['表示','増減のみ','非表示']),input('食べ忘れの声かけを表示','hints','checkbox'),input('食の好み・避けたい食材','preferences','textarea')]
};
function field(f,value) {
  const {label,key,type,extra,options,optional}=f;
  const name=' name="'+key+'"';
  if (type==='checkbox') return '<label><input type="checkbox"'+name+(value?' checked':'')+'>'+label+'</label>';
  if (type==='select') return '<label>'+label+'<select'+name+'>'+(optional?'<option value="">未記録</option>':'')+options.map(item=>'<option'+(item===value?' selected':'')+'>'+escape(item)+'</option>').join('')+'</select></label>';
  if (type==='textarea') return '<label>'+label+'<textarea'+name+' maxlength="20000">'+escape(value)+'</textarea></label>';
  return '<label>'+label+'<input type="'+type+'"'+name+' '+extra+(type==='file'?'':' value="'+escape(value)+'"')+'></label>';
}
function editor(type,id,seed) {
  if (!ready) throw new Error('保存機能を使えるSafariの画面で開いてください。');
  const dance=type==='dance';
  if (dance) type='exercise';
  const existing=type==='settings'?state.settings:state.records[type].find(row=>row.id===id);
  const row=existing||{date:type==='recipe'?'':today(),time:clock('time'),period:clock('time')<'15:00'?'朝':'夜',...seed,...(dance?{name:'ダンスレッスン担当',source:'dance'}:{})};
  if (!id && type==='condition' && at('condition')[0]) return editor(type,at('condition')[0].id);
  editing={type,row,existing};
  $('fields').innerHTML='<h2>'+escape(type==='settings'?'目標と表示':(dance?'ダンス担当':labels[type])+'を記録')+'</h2>'
    +(type==='settings'?blank('10kg減を目標にする場合は、開始時の体重とそこから10kg引いた値を入力できます。'):'')
    +schema[type].map(f=>field(f,row[f.key])).join('')
    +(photo(row.photo)?'<label><input type="checkbox" name="removePhoto">現在の写真を外す</label>':'');
  $('form-error').textContent='';
  $('editor').showModal();
}
async function submit(event) {
  event.preventDefault();
  if ($('submit').disabled) return;
  $('submit').disabled=true;
  const {type,row,existing}=editing;
  const form=new FormData(event.currentTarget);
  try {
    const record={...row};
    for(const f of schema[type]) {
      const raw=form.get(f.key);
      if (f.type==='file') {
        if (raw?.size) record.photo=await imageData(raw);
        else if (form.has('removePhoto')) record.photo='';
      } else if(f.type==='checkbox') record[f.key]=form.has(f.key);
      else if(f.type==='number') record[f.key]=raw===''?null:Number(raw);
      else record[f.key]=raw.trim();
    }
    if (record.name!==undefined && !record.name) throw Error('内容を入力してください。');
    if (record.url&&!safeURL(record.url)) throw Error('https:// または http:// のURLを入力してください。');
    if (type==='body'&&['weight','waist','left','right'].every(key=>record[key]===null)&&!record.memo) throw Error('測った項目かメモを1つ入力してください。');
    if (type==='pressure'&&record.sys<=record.dia) throw Error('最高血圧と最低血圧の入力をご確認ください。');
    const next=structuredClone(state);
    if(type==='settings') next.settings=record;
    else {
      record.id=existing?.id||uid();
      next.records[type]=next.records[type].filter(item=>item.id!==record.id).concat(record);
    }
    await save(next);
    $('editor').close();
    if(type==='pressure' && highBP(record)) page='pressure';
    render();
    message('保存しました');
  } catch(error) {$('form-error').textContent=error.message}
  finally {$('submit').disabled=false}
}
const photoHTML = row => photo(row.photo)?'<img src="'+row.photo+'" alt="記録の写真" loading="lazy">':'';
const detail = (title,text) => text!=null&&text!==''?'<p><b>'+title+'</b> '+escape(text)+'</p>':'';
function entry(type,row) {
  const links=safeURL(row.url)?'<p><a href="'+escape(safeURL(row.url))+'" target="_blank" rel="noreferrer noopener">元の投稿・レシピを開く</a></p>':'';
  const body=type==='body' ? (state.settings.display==='表示'?detail('体重',row.weight==null?'':row.weight+' kg'):'')
    +detail('ウエスト',row.waist==null?'':row.waist+' cm')+detail('左腕',row.left==null?'':row.left+' cm')+detail('右腕',row.right==null?'':row.right+' cm'):'';
  const condition=type==='condition'?schema.condition.filter(f=>!['date','memo'].includes(f.key)).map(f=>detail(f.label,row[f.key])).join(''):'';
  return '<article class="entry"><p><b>'+escape([row.kind,row.name].filter(Boolean).join(' ')||row.date||labels[type])+'</b> '+escape([row.kind||row.name?row.date:'',row.time,row.made?'作った':''].filter(Boolean).join('　'))+'</p>'
    +detail('分',row.minutes)+body+condition+detail('材料',row.ingredients)+detail('作り方',row.method)+detail('メモ',row.memo)+links+photoHTML(row)
    +'<div class="actions">'+(type!=='favorite'?button('編集','edit',type+':'+row.id):'')
    +(type==='meal'||type==='favorite'?button('もう一度記録','reuse',type+':'+row.id):'')
    +(type==='meal'?button('お気に入りに追加','favorite',row.id):'')
    +(type==='recipe'?button(row.made?'未調理に戻す':'作った','made',row.id):'')
    +button('削除','delete',type+':'+row.id)+'</div></article>';
}
const entries=(type)=>list(type).map(row=>entry(type,row)).join('')||blank('まだ記録がありません。');
function chart(rows,series,unit) {
  const items=rows.filter(row=>series.some(([key])=>val(row[key])!==null)).slice(0,90).reverse();
  const points=items.flatMap(row=>series.map(([key])=>val(row[key])).filter(v=>v!==null));
  if(!points.length) return blank('記録すると推移が表示されます。');
  const low=Math.min(...points), high=Math.max(...points), span=high-low||1;
  const start=dayMs(items[0].date), end=dayMs(items.at(-1).date);
  const x=row=>end===start?255:58+406*(dayMs(row.date)-start)/(end-start);
  const y=n=>148-115*(n-low)/span;
  const dates='<text x="58" y="177">'+escape(items[0].date.slice(5))+'</text><text x="466" y="177" text-anchor="end">'+escape(items.at(-1).date.slice(5))+'</text>';
  return '<svg class="chart" viewBox="0 0 490 188" role="img" aria-label="'+escape(series.map(([,label])=>label).join('・'))+'の推移">'
    + '<path d="M58 25V150H466" stroke="#ab899a" fill="none"/><text x="4" y="40">'+high+'</text><text x="4" y="150">'+low+'</text>'+dates
    +series.map(([key,label,color])=>{
      const collection=items.filter(row=>val(row[key])!==null);
      return '<polyline fill="none" stroke="'+color+'" stroke-width="2.5" points="'+collection.map(row=>x(row)+','+y(row[key])).join(' ')+'"/>'
        +collection.map(row=>'<circle cx="'+x(row)+'" cy="'+y(row[key])+'" r="4" fill="'+color+'"><title>'+escape(row.date+' '+label+' '+row[key]+' '+unit)+'</title></circle>').join('');
    }).join('')+'</svg><p class="muted">'+series.map(([,label])=>escape(label)).join(' ／ ')+'（'+unit+'、最近90件まで）</p>';
}
function bodyPage() {
  const rows=list('body'), display=state.settings.display;
  const base=state.settings.baseline??rows.findLast(row=>val(row.weight)!==null)?.weight;
  const byDelta=rows.map(row=>({...row,weight:val(row.weight)!==null&&base!=null?rounded(row.weight-base):null}));
  return box('体重・身体サイズ','<div class="actions">'+button('測定を記録','edit','body',true)+button('目標と表示を変更','edit','settings')+'</div>'+progress()
  +(display==='非表示'?'':chart(display==='増減のみ'?byDelta:rows,[['weight',display==='増減のみ'?'開始時からの増減':'体重','#9d285b']],'kg'))
  +'<h3>ウエスト・二の腕</h3>'+chart(rows,[['waist','ウエスト','#9d285b']],'cm')+chart(rows,[['left','左腕','#293e9d'],['right','右腕','#227658']],'cm'))
  +box('測定履歴',entries('body'));
}
const highBP = row => row && (row.sys>180||row.dia>120);
const avg = (rows,key) => {const values=rows.map(row=>val(row[key])).filter(v=>v!==null);return values.length?Math.round(values.reduce((a,b)=>a+b,0)/values.length):'—'};
function pressurePage() {
  const rows=list('pressure');
  const warning='<p class="warning">胸の痛み、息苦しさ、突然の片側のしびれ・脱力、ろれつが回らないなどの症状があれば、血圧の数字にかかわらず119番へ。</p>';
  const high=rows.some(row=>highBP(row)&&row.date===today())?'<p class="warning">今日、最高180または最低120を超える記録があります。上の症状がある場合は119番へ。症状がなければ1分以上あけて測り直し、同程度なら速やかに医療機関へご相談ください。</p>':'';
  const averages=[['直近7日',shift(today(),-6)],['今月',today().slice(0,7)+'-01']].flatMap(([range,start])=>['朝','夜'].map(period=>{
    const subset=rows.filter(row=>row.date>=start&&row.date<=today()&&row.period===period);
    return '<tr><th scope="row">'+range+'・'+period+'</th><td>'+subset.length+'</td><td>'+avg(subset,'sys')+' / '+avg(subset,'dia')+'</td><td>'+avg(subset,'pulse')+'</td></tr>';
  })).join('');
  const history=rows.map(row=>'<tr><td>'+escape(row.date)+'<br>'+escape(row.period)+' '+escape(row.time)+'</td><td>'+escape(row.sys)+' / '+escape(row.dia)+'</td><td>'+escape(row.pulse??'—')+'</td><td>'+escape(row.memo)+'</td><td class="no-print">'+button('編集','edit','pressure:'+row.id)+button('削除','delete','pressure:'+row.id)+'</td></tr>').join('');
  return box('血圧・脈拍','<div class="actions">'+button('血圧を記録','edit','pressure',true)+button('CSV出力','csv','pressure')+button('印刷','print')+'</div>'+warning+high
    +chart(rows,[['sys','最高','#9d285b'],['dia','最低','#314a9b']],'mmHg')+chart(rows,[['pulse','脈拍','#227658']],'回/分')
    +'<p class="muted">血圧値による診断は行いません。'+ '<a href="https://www.heart.org/en/health-topics/high-blood-pressure/understanding-blood-pressure-readings/when-to-call-911-for-high-blood-pressure" target="_blank" rel="noreferrer noopener">高い血圧値の目安（AHA）</a></p>','no-print')
  +box('血圧の平均','<div class="table-wrap"><table><thead><tr><th>期間</th><th>件数</th><th>最高 / 最低（mmHg）</th><th>脈拍</th></tr></thead><tbody>'+averages+'</tbody></table></div>')
  +box('受診用の血圧・脈拍記録',history?'<div class="table-wrap"><table><thead><tr><th>測定日・時間</th><th>最高 / 最低（mmHg）</th><th>脈拍</th><th>体調・メモ</th><th class="no-print">操作</th></tr></thead><tbody>'+history+'</tbody></table></div>':blank('まだ記録がありません。'));
}
const planFields=['breakfast','lunch','dinner','snack','recipe','exercise','budget','quick','outside'];
const planExtras=['shopping','reuse','prep'];
function parsePlan(value) {
  if(!value||!Array.isArray(value.days)||value.days.length!==7) throw Error('7日分の days を含むJSONを貼り付けてください。');
  const text=value=>typeof value==='string'?value.trim().slice(0,20000):'';
  const result={days:value.days.map(item=>{
    if(!item||!validDate(item.date)||!['breakfast','lunch','dinner'].every(key=>text(item[key]))) throw Error('各日に日付と朝・昼・夕の献立が必要です。');
    return {date:item.date,...Object.fromEntries(planFields.map(key=>[key,text(item[key])]))};
  }).sort((a,b)=>a.date.localeCompare(b.date))};
  if(result.days.some((item,index)=>item.date!==shift(result.days[0].date,index))) throw Error('献立の日付を連続する7日間にしてください。');
  for(const key of planExtras) result[key]=text(value[key]);
  return result;
}
function planPage() {
  const plan=state.plan;
  return box('献立の準備',planIntro()+'<div class="actions">'+button('チャッピーに相談する','page','consult',true)+button('食べたい料理を見る','page','recipes')+'</div>')
    +(plan?box('7日間の献立',detail('買い物リスト',plan.shopping)+detail('食材の使い回し',plan.reuse)+detail('作り置き',plan.prep)
      +plan.days.map(item=>'<article class="entry"><h3>'+prettyDate(item.date)+'</h3>'+mealPlan(item)+detail('簡単レシピ',item.recipe)+detail('運動計画',item.exercise)+detail('節約',item.budget)+detail('忙しい日',item.quick)+detail('外食・コンビニ',item.outside)+'</article>').join('')):'')
    +box('チャッピーの献立・運動計画を取り込む','<label>受け取ったJSON<textarea id="import-plan" placeholder="ここに貼り付け"></textarea></label>'+button('7日分を取り込む','import-plan'));
}
function consultation() {
  const from=shift(today(),-6);
  const included=tables.filter(key=>key!=='favorite').filter(key=>$('share-'+key)?.checked);
  const selected=Object.fromEntries(included.map(key=>[labels[key],list(key).filter(row=>key==='recipe'?!row.made:row.date>=from&&row.date<=today()).map(({photo,id,source,...row})=>row)]));
  const weekday=new Date(dayMs(today())).getUTCDay();
  const next=shift(today(),(8-weekday)%7||7);
  const template={days:[{date:next,...Object.fromEntries(planFields.map(key=>[key,'記入']))}],shopping:'買い物リスト',reuse:'食材の使い回し',prep:'作り置き'};
  return '直近7日（'+from+'〜'+today()+'）のうち選んだ記録を参考に、'+next+'から連続する7日間の献立・運動計画を作ってください。食事抜きや極端な制限を避け、普段の好みと作りたい料理を活用。忙しい日、節約、外食・コンビニも提案。運動は5〜15分程度、狭い室内でもできるものを中心に、体調が悪い日は休養を優先。病気の診断はしないでください。\n'
    +(state.settings.preferences?'食の好み：'+state.settings.preferences+'\n':'')
    +'次の形式で、days は連続した7日分、各項目は文字列にした純粋なJSONを返してください。recipe は簡単レシピ、budget は節約、quick は時短、outside は外食・コンビニ用です。\n'+JSON.stringify(template,null,2)
    +'\n\n選んだ記録（写真なし）\n'+JSON.stringify(selected,null,2);
}
function consultPage() {
  return box('チャッピーに相談する','<p>相談に含める項目を選び、文章を確認してください。コピーしたあと、ご自身でChatGPTに貼り付けて送れます。</p>'
    +tables.filter(key=>key!=='favorite').map(key=>'<label><input id="share-'+key+'" type="checkbox" '+(['meal','exercise','recipe'].includes(key)?'checked':'')+'>'+labels[key]+'</label>').join('')
    +'<div class="actions">'+button('相談文を作る','draft')+button('相談文をコピー','copy','',true)+'</div><label>相談文を確認・編集<textarea id="draft" rows="10"></textarea></label><p><a href="https://chatgpt.com/" target="_blank" rel="noreferrer noopener">ChatGPTを開く</a></p>'+button('受け取った計画を取り込む','page','plan'));
}
function dataPage() {
  return box('バックアップと設定','<p>記録はこのブラウザ・ホーム画面アプリの保存領域に残ります。別端末に移すときやブラウザのデータを消す前はJSONを書き出してください。</p>'
    +'<div class="actions">'+button('JSONバックアップ','backup','',true)+button('全記録をCSV出力','csv','all')+button('目標・表示の設定','edit','settings')+'</div>'
    +'<label>JSONファイルから復元（旧Ver.3にも対応）<input type="file" id="restore" accept=".json,application/json"></label><p class="muted">現在の記録を先にバックアップしてください。復元すると手帳全体が選んだファイルの内容になります。</p>'
    +'<p class="muted">バージョン '+VERSION+'</p>');
}
const pages = {
  home:['今日',home],
  meal:['食事',()=>box('食事日記','<div class="actions">'+mealKinds.map(kind=>button(kind+'を記録','meal-kind',kind)).join('')+'</div>'+mealHint()+entries('meal'))+box('お気に入り',entries('favorite'))],
  exercise:['運動',()=>exercises()+box('運動履歴',button('活動を記録','edit','exercise')+entries('exercise'))],
  body:['体重・サイズ',bodyPage],
  pressure:['血圧',pressurePage],
  condition:['体調',()=>box('体調日記',button('今日の体調を記録','edit','condition',true)+entries('condition'))],
  plan:['献立',planPage],
  recipes:['食べたい料理',()=>box('食べたいものリスト','<p class="muted">作りたい料理は、来週の献立相談に含められます。</p>'+button('料理を登録','edit','recipe',true)+entries('recipe'))],
  consult:['相談',consultPage],
  data:['設定・保存',dataPage]
};
function render() {
  shownDay=today();
  $('nav').innerHTML=Object.entries(pages).map(([key,[label]])=>'<button type="button" data-action="page" data-value="'+key+'"'+(key===page?' aria-current="page"':'')+'>'+label+'</button>').join('');
  $('main').innerHTML=(!ready?'<p class="warning">端末保存を利用できません。Safariの通常画面で開いてください。</p>':'')+pages[page][1]();
}
function download(filename,content,type) {
  const url=URL.createObjectURL(new Blob([content],{type}));
  const link=document.createElement('a');
  link.href=url;link.download=filename;document.body.append(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),60000);
}
const csvCell=value=>{const text=String(value??'');return '"'+(/^[\s\uFEFF]*[=+\-@\t\r]/.test(text)&&typeof value!=='number'?"'":'')+text.replaceAll('"','""')+'"'};
function csv(type) {
  const keys=type==='pressure'?['date','time','period','sys','dia','pulse','memo']:['date','time','kind','name','minutes','source','weight','waist','left','right','period','sys','dia','pulse','sleep','sleepQuality','fatigue','mood','appetite','hunger','back','bowel','url','ingredients','method','made','memo'];
  const titles={date:'日付',time:'時間',period:'朝・夜',sys:'最高血圧 (mmHg)',dia:'最低血圧 (mmHg)',pulse:'脈拍 (/分)',memo:'体調・メモ'};
  const body=type==='pressure'?list('pressure').map(row=>keys.map(key=>row[key])):tables.flatMap(table=>list(table).map(row=>[labels[table],...keys.map(key=>row[key])]));
  const header=keys.map(key=>titles[key]||key);
  if(type!=='pressure') header.unshift('記録の種類');
  download('health-'+type+'-'+today()+'.csv','\uFEFF'+[header,...body].map(row=>row.map(csvCell).join(',')).join('\r\n'),'text/csv;charset=utf-8');
}
function migrateLegacy(raw) {
  if(!raw?.goal||!raw.entries||typeof raw.entries!=='object'||Array.isArray(raw.entries)) throw Error('このJSONは手帳のバックアップ形式に対応していません。');
  const next=empty(), dates=Object.keys(raw.entries).filter(validDate).sort();
  next.started=dates[0]||today();
  Object.assign(next.settings,{deadline:validDate(raw.goal.deadline)?raw.goal.deadline:next.settings.deadline,baseline:val(raw.goal.baseline),target:val(raw.goal.target),display:raw.hidden?'非表示':'表示'});
  for(const date of dates){
    const row=raw.entries[date];
    if(!row||typeof row!=='object') throw Error('旧版の日付データを読み込めませんでした。');
    for(const [i,key] of ['breakfast','lunch','dinner','snack'].entries()) if(row[key]) next.records.meal.push({id:uid(),date,kind:mealKinds[i],name:String(row[key])});
    if(val(row.weight)!==null) next.records.body.push({id:uid(),date,weight:row.weight});
    if(row.movement||raw.exerciseChoices?.[date]) next.records.exercise.push({id:uid(),date,name:String(row.movement||raw.exerciseChoices[date]),source:'legacy'});
    if(row.mood||row.memo) next.records.condition.push({id:uid(),date,mood:String(row.mood||''),memo:String(row.memo||'')});
  }
  if(Array.isArray(raw.recipes)) next.records.recipe=raw.recipes.filter(item=>item?.name).map(item=>({id:uid(),name:String(item.name),url:safeURL(item.url),memo:String(item.memo||'')}));
  return next;
}
function validateBackup(raw) {
  if(raw?.schema!==1){
    if(raw?.schema!==undefined) throw Error('このバージョンでは復元できない形式です。');
    raw=migrateLegacy(raw);
  }
  if(!validDate(raw.started)||!validDate(raw.settings?.deadline)||!['表示','増減のみ','非表示'].includes(raw.settings.display)) throw Error('バックアップの設定を確認してください。');
  const next=empty();
  next.started=raw.started;
  next.settings={deadline:raw.settings.deadline,display:raw.settings.display,hints:raw.settings.hints!==false,baseline:val(raw.settings.baseline),target:val(raw.settings.target),preferences:typeof raw.settings.preferences==='string'?raw.settings.preferences:''};
  for(const type of tables){
    const rows=raw.records?.[type];
    if(!Array.isArray(rows)) throw Error('バックアップに必要な記録がありません。');
    const seen=new Set();
    next.records[type]=rows.map(row=>{
      if(!row||typeof row.id!=='string'||!row.id||seen.has(row.id)||(!['recipe','favorite'].includes(type)&&!validDate(row.date))||(row.date&&!validDate(row.date))) throw Error('バックアップに読み込めない記録があります。');
      seen.add(row.id);
      const result={id:row.id};
      const fields=type==='favorite'?schema.meal:schema[type];
      for(const f of fields){
        const v=row[f.key];
        if(f.type==='number') result[f.key]=val(v);
        else if(f.type==='file') result[f.key]=photo(v);
        else if(f.type==='checkbox') result[f.key]=v===true;
        else if(typeof v==='string') result[f.key]=f.type==='url'?safeURL(v):v;
      }
      if(typeof row.source==='string') result.source=row.source;
      if(type==='pressure'&&(result.sys===null||result.dia===null||result.sys<=result.dia)) throw Error('読み込めない血圧の値があります。');
      return result;
    });
  }
  for(const [key,value] of Object.entries(raw.offset||{})) if(validDate(key)&&Number.isSafeInteger(value)&&value>=0&&value<1000000) next.offset[key]=value;
  for(const [key,value] of Object.entries(raw.mode||{})) if(validDate(key)&&modes.includes(value)) next.mode[key]=value;
  if(raw.plan) next.plan=parsePlan(raw.plan);
  return next;
}
async function restore(file) {
  if(!file) return;
  if(file.size>150*1024*1024) throw Error('バックアップが大きすぎます（上限150MB）。');
  const next=validateBackup(JSON.parse(await file.text()));
  if(!confirm('現在のデータをこのバックアップで置き換えますか？')) return;
  await save(next);render();message('バックアップを復元しました');
}
let busy=false;
async function action(name,value) {
  const [type,id]=value.split(':');
  if(name==='page'){page=value;render();window.scrollTo(0,0);return}
  if(name==='edit'){editor(type,id);return}
  if(name==='meal-kind'){editor('meal',null,{kind:value});return}
  if(name==='close'){if(!$('submit').disabled) $('editor').close();return}
  if(name==='draft'){$('draft').value=consultation();return}
  if(name==='copy'){
    const draft=$('draft');
    if(!draft.value) draft.value=consultation();
    try{await navigator.clipboard.writeText(draft.value);message('コピーしました')}catch{draft.focus();draft.select();message('選択した相談文をコピーしてください')}
    return;
  }
  if(name==='backup'){download('natsu-journal-'+today()+'.json',JSON.stringify(state,null,2),'application/json');return}
  if(name==='csv'){csv(value);return}
  if(name==='print'){window.print();return}
  if(name==='reuse'){
    const row=state.records[type].find(item=>item.id===id);
    if(row) editor('meal',null,{name:row.name,kind:row.kind,memo:row.memo});
    return;
  }
  const next=structuredClone(state);
  if(name==='another') next.offset[today()]=(next.offset[today()]||0)+1;
  if(name==='mode'){next.mode[today()]=value;next.offset[today()]=0}
  if(name==='done'){
    const [title,dose]=workout();
    next.records.exercise.push({id:uid(),date:today(),name:title,memo:dose,source:'daily'});
  }
  if(name==='favorite'){
    const row=state.records.meal.find(item=>item.id===value);
    if(!row) return;
    if(next.records.favorite.some(item=>item.name===row.name&&item.kind===row.kind)){message('お気に入りに登録済みです');return}
    next.records.favorite.push({id:uid(),name:row.name,kind:row.kind,memo:row.memo});
  }
  if(name==='made'){
    const row=next.records.recipe.find(item=>item.id===value);
    if(!row) return;
    row.made=!row.made;
  }
  if(name==='delete'){
    if(!confirm('この記録を削除しますか？')) return;
    next.records[type]=next.records[type].filter(item=>item.id!==id);
  }
  if(name==='import-plan'){
    const text=$('import-plan').value.trim().replace(/^```(?:json)?\s*|\s*```$/gi,'');
    let parsed;
    try{parsed=JSON.parse(text)}catch{throw Error('献立のJSONを貼り付けてください。')}
    next.plan=parsePlan(parsed);
    if(state.plan&&!confirm('現在の献立を新しい7日分に置き換えますか？')) return;
  }
  await save(next);render();
  if(name==='done') message('今日の活動を追加しました');
  if(name==='favorite') message('お気に入りに追加しました');
  if(name==='import-plan') message('7日間の献立・運動計画を取り込みました');
}
async function run(callback) {
  if(busy||$('submit').disabled) return;
  busy=true;
  try {await callback()} catch(error){message(error.message||'操作に失敗しました')} finally {busy=false}
}
document.addEventListener('click',event=>{
  const target=event.target.closest('[data-action]');
  if(target) run(()=>action(target.dataset.action,target.dataset.value||''));
});
document.addEventListener('change',event=>{
  const target=event.target;
  if(target.id==='mode') run(()=>action('mode',target.value));
  if(target.id==='restore') run(async()=>{try{await restore(target.files[0])}finally{target.value=''}});
  if(target.id.startsWith('share-')&&$('draft')) $('draft').value='';
});
$('form').addEventListener('submit',submit);
$('editor').addEventListener('cancel',event=>{if($('submit').disabled)event.preventDefault()});
const refresh = () => {if(shownDay!==today()&&!$('editor').open&&page!=='consult')render()};
document.addEventListener('visibilitychange',refresh);
setInterval(refresh,30000);
(async()=>{
  try {
    db=await openDB();
    const record=await load();
    if(record){state=validateBackup(record);revision=record.revision??null}
    ready=true;
    if(!record) await save(state);
  }catch{ready=false}
  render();
  if(isSecureContext&&'serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(()=>{});
})();
