// utils/watchpay.js
// Implements signing exactly like the PHP signapi.php + GBK conversion for WatchPay

const crypto = require('crypto');
const iconv = require('iconv-lite');

function buildPaymentSignString(params) {
  // Follow exact order from PHP sample:
  // bank_code (if any) -> goods_name -> mch_id -> mch_order_no ->
  // mch_return_msg (if any) -> notify_url -> order_date ->
  // page_url (if any) -> pay_type -> trade_amount -> version
  // NOTE: do NOT include sign_type or sign in this string
  let signStr = '';
  if (params.bank_code) signStr += `bank_code=${params.bank_code}&`;
  signStr += `goods_name=${params.goods_name}&`;
  signStr += `mch_id=${params.mch_id}&`;
  signStr += `mch_order_no=${params.mch_order_no}&`;
  if (params.mch_return_msg) signStr += `mch_return_msg=${params.mch_return_msg}&`;
  signStr += `notify_url=${params.notify_url}&`;
  signStr += `order_date=${params.order_date}&`;
  if (params.page_url) signStr += `page_url=${params.page_url}&`;
  signStr += `pay_type=${params.pay_type}&`;
  signStr += `trade_amount=${params.trade_amount}&`;
  signStr += `version=${params.version}`;
  return signStr;
}

function buildCallbackSignStringCallback(params) {
  // From the PHP callback example, the signature string for callback is:
  // amount=...&mchId=...&mchOrderNo=...&merRetMsg=...&orderDate=...&orderNo=...&oriAmount=...&tradeResult=...
  // (skip empty fields)
  const keys = ['amount','mchId','mchOrderNo','merRetMsg','orderDate','orderNo','oriAmount','tradeResult'];
  let parts = [];
  for (const k of keys) {
    if (params[k] !== undefined && params[k] !== null && params[k] !== '') {
      parts.push(`${k}=${params[k]}`);
    }
  }
  return parts.join('&');
}

function md5GbkHex(str, key) {
  const withKey = (key && key.length) ? `${str}&key=${key}` : str;
  // Convert to GBK bytes same as PHP convToGBK before MD5
  const gbkBuf = iconv.encode(withKey, 'gbk');
  return crypto.createHash('md5').update(gbkBuf).digest('hex');
}

module.exports = {
  buildPaymentSignString,
  buildCallbackSignStringCallback,
  md5GbkHex
};
