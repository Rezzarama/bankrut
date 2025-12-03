export function generateAccountNumber(customerId) {
  // contoh sederhana: 1 + (customerId dipad) + 1  => 11 digit
  const base = String(1000000000 + customerId).slice(-9);
  return `1${base}1`;
}
