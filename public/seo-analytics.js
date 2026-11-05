// Anonymous engagement goals for the existing Yandex Metrika counter.
// Do not transmit phone numbers, names, booking dates or other personal data.
(()=>{
 const counter=114076900;
 const reach=goal=>{try{if(typeof window.ym==='function')window.ym(counter,'reachGoal',goal);}catch{}};
 document.addEventListener('click',event=>{
  const link=event.target.closest?.('a[href]');
  if(link){const href=link.getAttribute('href')||'';
   if(href.startsWith('tel:'))reach('phone_click');
   else if(/^https?:\/\/(?:wa\.me|api\.whatsapp\.com)\//i.test(href))reach('whatsapp_click');
  }
  const button=event.target.closest?.('button');
  if(button&&(/снять дом|забронировать|оставить заявку/i).test((button.textContent||'').trim()))reach('booking_button_click');
 },{passive:true});
})();
