let writes=Promise.resolve();
function log(entry){writes=writes.catch(()=>{}).then(async()=>{const {pb_log=[]}=await chrome.storage.local.get('pb_log');await chrome.storage.local.set({pb_log:[...pb_log,entry].slice(-200)});});return writes;}
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(!['pb:protect','pb:log'].includes(message?.type))return;
  (async()=>{
    if(message.type==='pb:protect'){
      const {deal,item,seller,hash,signals,reason}=message;
      await chrome.tabs.create({url:chrome.runtime.getURL('order.html')+'?d='+encodeURIComponent(JSON.stringify({deal,item,seller,hash,signals,reason}))});
      await log({action:'protect',hash,signals,head:reason.slice(0,160),url:sender.url?.split('?')[0],ts:Date.now()});
    }else await log(message.entry);
    respond({ok:true});
  })().catch(()=>respond({ok:false}));
  return true;
});
