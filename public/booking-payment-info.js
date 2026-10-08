function element(tagName, className, text) {
 const node=document.createElement(tagName);
 if(className)node.className=className;
 if(text)node.textContent=text;
 return node;
}

function addBookingInfo(){
 const form=document.querySelector('#booking');
 const submit=form?.querySelector('button.primary');
 if(!form||!submit)return;

 let info=form.querySelector('[data-booking-payment-info]');
 if(!info){
  info=element('aside','booking-payment-info');
  info.dataset.bookingPaymentInfo='';
  info.setAttribute('aria-labelledby','booking-payment-info-title');

  const heading=element('div','booking-payment-info__heading');
  heading.append(element('span','booking-payment-info__icon','i'));
  const title=element('h3','', 'УСЛОВИЯ БРОНИРОВАНИЯ');
  title.id='booking-payment-info-title';
  heading.append(title);
  info.append(heading);
  info.append(element('p','booking-payment-info__intro','Всё просто и прозрачно.'));

  const payments=element('div','booking-payment-info__payments');
  const prepayment=element('div','booking-payment-info__payment');
  prepayment.append(element('h4','', '10 000 ₽ — предоплата за бронирование.'));
  prepayment.append(element('p','', 'Закрепляет выбранные даты и учитывается в стоимости проживания. Детали согласуем с вами по телефону.'));
  payments.append(prepayment);

  const deposit=element('div','booking-payment-info__payment');
  deposit.append(element('h4','', '10 000 ₽ — возвратный залог.'));
  deposit.append(element('p','', 'Вносится при заселении и полностью возвращается сразу после выезда и проверки дома, если всё в порядке.'));
  payments.append(deposit);
  info.append(payments);
  info.append(element('p','booking-payment-info__note','Предоплата и залог — два отдельных платежа.'));
 }
 if(info.nextElementSibling!==submit)form.insertBefore(info,submit);
}

function addDepositInfo(){
 const trigger=[...document.querySelectorAll('[data-slot="accordion-trigger"]')]
  .find(button=>button.textContent.trim().startsWith('Условия проживания'));
 const item=trigger?.closest('[data-slot="accordion-item"]');
 const panel=item?.querySelector('[data-slot="accordion-content"]');
 if(!panel||panel.querySelector('[data-payment-info-rules]'))return;
 if(!panel.querySelector('p'))return;

 const info=element('div','booking-payment-info__rules');
 info.dataset.paymentInfoRules='';
 info.append(element('h4','', 'Возвратный залог'));
 info.append(element('p','', 'При заселении вносится залог 10 000 ₽ для обеспечения сохранности имущества.'));
 info.append(element('p','', 'После выезда и проверки состояния дома залог сразу возвращается в полном объёме, если всё в порядке.'));
 panel.append(info);
}

function enhancePage(){
 addBookingInfo();
 addDepositInfo();
}

function start(){
 enhancePage();
 const observer=new MutationObserver(enhancePage);
 observer.observe(document.documentElement,{childList:true,subtree:true});
}

if(document.readyState==='complete')start();
else window.addEventListener('load',start,{once:true});
