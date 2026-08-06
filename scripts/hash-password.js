// Kullanım: npm run hash-password -- "seçtiğin-şifre"
// Çıktıyı .env dosyasındaki APP_PASSWORD_HASH değerine yapıştır.
const bcrypt = require('bcryptjs');

const pw = process.argv[2];
if (!pw) {
  console.error('Kullanım: npm run hash-password -- "şifre"');
  process.exit(1);
}
const hash = bcrypt.hashSync(pw, 12);
console.log(hash);
