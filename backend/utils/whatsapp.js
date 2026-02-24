/**
 * Mock WhatsApp notification sender.
 * Replace with actual WhatsApp Business API integration in Phase 2.
 */

async function sendWhatsAppMessage(phoneNumber, message) {
  console.log(`[WhatsApp Mock] To: ${phoneNumber}`);
  console.log(`[WhatsApp Mock] Message: ${message}`);
  return { success: true, mock: true };
}

async function sendPaymentReceipt(phoneNumber, memberName, amount) {
  return sendWhatsAppMessage(
    phoneNumber,
    `Hi ${memberName}, your payment of Rs.${amount} has been received. Thank you!`
  );
}

async function sendExpiryReminder(phoneNumber, memberName, daysLeft) {
  return sendWhatsAppMessage(
    phoneNumber,
    `Hi ${memberName}, your membership expires in ${daysLeft} days. Please renew soon!`
  );
}

module.exports = { sendWhatsAppMessage, sendPaymentReceipt, sendExpiryReminder };
