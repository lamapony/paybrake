let data={};
try{data=JSON.parse(new URLSearchParams(location.search).get('d')||'{}')||{};}catch{}
const put=(id,value)=>document.getElementById(id).textContent=value;
put('item',typeof data.item==='string'?data.item:'Item from chat');
put('seller',typeof data.seller==='string'?data.seller:'Seller');
put('asked',typeof data.reason==='string'?data.reason:'Payment request from chat');
const amount=data.deal?.amount,currency=data.deal?.currency;
if(typeof amount==='number'&&Number.isFinite(amount))put('order-amount',currency==='DKK'?`${amount} kr`:currency==='EUR'?`€${amount}`:currency==='USD'?`$${amount}`:String(amount));
document.getElementById('order-create').addEventListener('click',()=>{
  const bytes=crypto.getRandomValues(new Uint8Array(4));
  put('status',`Sandbox order created · ID MOCK-${[...bytes].map(b=>b.toString(16).padStart(2,'0')).join('').toUpperCase()} · awaiting approval`);
  document.getElementById('order-create').disabled=true;
});
