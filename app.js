function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}
// ========== دوال مساعدة ==========
async function sha256(message) {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// ========== قاعدة البيانات ==========
const db = new Dexie("AlashoolDB");
db.version(1).stores({
  products: "++id, name, toyotaCode, quantity, sellPrice, dateAdded",
  transactions: "++id, date, productName, quantity, unitPrice, total, paymentMethod, type, status, entityName, entityPhone",
  debts: "++id, transactionId, entityName, entityPhone, debtType, amount, date, productName, status",
  consignments: "++id, transactionId, technicianName, technicianPhone, productName, quantity, date, status",
  expenses: "++id, date, reason, amount, workerId",
  workers: "++id, name, phone, salary",
  worker_transactions: "++id, workerId, amount, reason, date"
});

// ========== الحالة العامة ==========
let currentUser = null;
const PASSWORDS = { manager: "2005", employee: "0000" };
let passwordHashes = {};

// ========== بدء التطبيق ==========
async function loadApp() {
  await db.open();
  passwordHashes.manager = await sha256(PASSWORDS.manager);
  passwordHashes.employee = await sha256(PASSWORDS.employee);
  renderLogin();
}

// ========== المصادقة ==========
function renderLogin() {
  document.getElementById('app').innerHTML = `
    <div class="card">
      <h3>🔐 تسجيل الدخول</h3>
      <select id="roleSelect">
        <option value="manager">مدير</option>
        <option value="employee">موظف</option>
      </select>
      <input type="password" id="password" placeholder="كلمة المرور">
      <button class="btn" onclick="login()">دخول</button>
      <p id="loginError" style="color:red;"></p>
    </div>`;
}

async function login() {
  const role = document.getElementById('roleSelect').value;
  const pass = document.getElementById('password').value;
  const hash = await sha256(pass);
  if (hash === passwordHashes[role]) {
    currentUser = { role, username: role === 'manager' ? 'مدير' : 'موظف' };
    renderDashboard();
  } else {
    document.getElementById('loginError').textContent = '❌ كلمة المرور غير صحيحة';
  }
}

function logout() {
  currentUser = null;
  renderLogin();
}

// ========== القائمة ==========
function getMenuButtons() {
  const managerPages = ['sales','debts','consignments','workers','inventory','expenses','reports','sync'];
  const employeePages = ['sales','debts','consignments','workers','sync'];
  const pages = currentUser.role === 'manager' ? managerPages : employeePages;
  const labels = {
    sales: '🛒 مبيعات', debts: '📋 ديون', consignments: '🔩 عهد',
    workers: '👷 عمال', inventory: '📦 مخزون', expenses: '💸 مصروفات',
    reports: '📑 تقارير', sync: '🔄 مزامنة'
  };
  return pages.map(p => `<button class="btn" onclick="render${capitalize(p)}()">${labels[p]}</button>`).join('');
}

function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

// ========== لوحة التحكم ==========
async function renderDashboard() {
  const today = new Date().toISOString().slice(0,10);
  const sales = await db.transactions.where('date').startsWith(today).toArray();
  const totalSales = sales.reduce((s, t) => s + t.total, 0);
  const expenses = await db.expenses.where('date').startsWith(today).toArray();
  const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0);
  const lowStock = await db.products.where('quantity').belowOrEqual(3).toArray();
  let html = `
    <div class="sidebar">${getMenuButtons()}</div>
    <div class="card">
      <h3>📊 ملخص اليوم (${today})</h3>
      <p>💰 المبيعات: <strong>${totalSales} ريال</strong></p>
      <p>💸 المصروفات: <strong>${totalExpenses} ريال</strong></p>
      <p>🧾 الصافي: <strong>${totalSales - totalExpenses} ريال</strong></p>
      ${lowStock.length ? `<p style="color:red;">⚠️ منتجات منخفضة: ${lowStock.map(p=>p.name).join(', ')}</p>` : ''}
    </div>`;
  document.getElementById('app').innerHTML = html;
}

// ========== المبيعات ==========
async function renderSales() {
  const products = await db.products.toArray();
  const options = products.map(p => `<option value="${p.id}">${p.name} (${p.toyotaCode||''}) - ${p.sellPrice} ريال (${p.quantity})</option>`).join('');
  document.getElementById('app').innerHTML = `
    <div class="sidebar">${getMenuButtons()}</div>
    <div class="card">
      <h3>🛒 تسجيل بيع</h3>
      <select id="productSelect">${options}</select>
      <input type="number" id="quantity" placeholder="الكمية" min="1" value="1">
      <select id="paymentMethod">
        <option value="cash">نقدي</option>
        <option value="transfer">حوالة</option>
        <option value="wallet">محفظة</option>
      </select>
      <select id="saleType">
        <option value="direct">بيع مباشر</option>
        <option value="debt">دين للزبون (لنا)</option>
        <option value="shop_debt">دين للمحل (علينا)</option>
        <option value="consignment">صرف لمهندس (عهدة)</option>
      </select>
      <div id="entityFields" style="display:none;">
        <input type="text" id="entityName" placeholder="اسم الزبون/المهندس">
        <input type="text" id="entityPhone" placeholder="رقم الهاتف">
      </div>
      <button class="btn" onclick="makeSale()">بيع</button>
      <div id="saleResult"></div>
    </div>`;
  document.getElementById('saleType').addEventListener('change', toggleEntityFields);
}

function toggleEntityFields() {
  const type = document.getElementById('saleType').value;
  document.getElementById('entityFields').style.display = (type !== 'direct') ? 'block' : 'none';
}

async function makeSale() {
  const productId = +document.getElementById('productSelect').value;
  const qty = +document.getElementById('quantity').value;
  const paymentMethod = document.getElementById('paymentMethod').value;
  const saleType = document.getElementById('saleType').value;
  const product = await db.products.get(productId);
  if (!product || product.quantity < qty) {
    document.getElementById('saleResult').innerHTML = '<span style="color:red;">❌ الكمية غير كافية</span>';
    return;
  }
  const unitPrice = product.sellPrice;
  const total = unitPrice * qty;
  const entityName = saleType !== 'direct' ? document.getElementById('entityName').value.trim() : '';
  const entityPhone = saleType !== 'direct' ? document.getElementById('entityPhone').value.trim() : '';
  await db.products.update(productId, { quantity: product.quantity - qty });
  const txId = await db.transactions.add({
    date: new Date().toISOString(), productName: product.name, quantity: qty,
    unitPrice, total, paymentMethod, type: saleType,
    status: saleType === 'direct' ? 'paid' : 'credit', entityName, entityPhone
  });
  if (saleType === 'debt' || saleType === 'shop_debt') {
    await db.debts.add({
      transactionId: txId, entityName, entityPhone,
      debtType: saleType === 'debt' ? 'given' : 'taken',
      amount: total, date: new Date().toISOString(), productName: product.name, status: 'unpaid'
    });
  } else if (saleType === 'consignment') {
    await db.consignments.add({
      transactionId: txId, technicianName: entityName, technicianPhone: entityPhone,
      productName: product.name, quantity: qty, date: new Date().toISOString(), status: 'active'
    });
  }
  document.getElementById('saleResult').innerHTML = `✅ تم بيع ${qty} ${product.name} بـ ${total} ريال`;
  setTimeout(() => renderSales(), 1000);
}

// ========== الديون ==========
async function renderDebts() {
  const debts = await db.debts.filter(d => d.status === 'unpaid').toArray();
  let rows = debts.map(d => `
    <tr>
      <td>${d.entityName}</td><td>${d.debtType === 'given' ? 'لنا' : 'علينا'}</td>
      <td>${d.amount} ريال</td><td>${new Date(d.date).toLocaleDateString('ar')}</td>
      <td><button class="btn btn-outline" onclick="settleDebt(${d.id})">سدد</button></td>
    </tr>`).join('');
  document.getElementById('app').innerHTML = `
    <div class="sidebar">${getMenuButtons()}</div>
    <div class="card"><h3>📋 الديون غير المسددة</h3>
      <table><tr><th>الاسم</th><th>النوع</th><th>المبلغ</th><th>التاريخ</th><th></th></tr>
      ${rows || '<tr><td colspan="5">لا توجد ديون</td></tr>'}</table>
    </div>`;
}

async function settleDebt(id) {
  const debt = await db.debts.get(id);
  if (!debt) return;
  await db.transactions.add({
    date: new Date().toISOString(), productName: debt.productName, quantity: 0,
    unitPrice: 0, total: debt.amount, paymentMethod: 'settlement', type: 'debt_settlement',
    status: 'paid', entityName: debt.entityName, entityPhone: debt.entityPhone
  });
  await db.debts.delete(id);
  renderDebts();
}

// ========== العهد ==========
async function renderConsignments() {
  const items = await db.consignments.filter(c => c.status === 'active').toArray();
  let rows = items.map(c => `
    <tr>
      <td>${c.technicianName}</td><td>${c.productName}</td><td>${c.quantity}</td>
      <td>${new Date(c.date).toLocaleDateString('ar')}</td>
      <td><button class="btn btn-outline" onclick="returnConsignment(${c.id})">إرجاع</button></td>
    </tr>`).join('');
  document.getElementById('app').innerHTML = `
    <div class="sidebar">${getMenuButtons()}</div>
    <div class="card"><h3>🔩 العهد النشطة</h3>
      <table><tr><th>المهندس</th><th>القطعة</th><th>الكمية</th><th>التاريخ</th><th></th></tr>
      ${rows || '<tr><td colspan="5">لا توجد عهد</td></tr>'}</table>
    </div>`;
}

async function returnConsignment(id) {
  const cons = await db.consignments.get(id);
  if (!cons) return;
  await db.transactions.add({
    date: new Date().toISOString(), productName: cons.productName, quantity: cons.quantity,
    unitPrice: 0, total: 0, paymentMethod: 'return', type: 'consignment_return',
    status: 'returned', entityName: cons.technicianName, entityPhone: cons.technicianPhone
  });
  await db.consignments.delete(id);
  renderConsignments();
}

// ========== العمال (المعادلات اليومية والشهرية) ==========
async function renderWorkers() {
  const workers = await db.workers.toArray();
  const today = new Date().toISOString().slice(0,10);
  let html = '<div class="sidebar">' + getMenuButtons() + '</div><div class="card"><h3>👷 العمال</h3>';
  if (currentUser.role === 'manager') {
    html += '<button class="btn" onclick="renderAddWorker()">إضافة عامل</button>';
  }
  html += '<table><tr><th>الاسم</th><th>رقم الهاتف</th><th>الراتب</th><th>مسحوبات اليوم</th><th>إجمالي المسحوبات الشهرية</th><th>الصافي (نهاية الشهر)</th>';
  if (currentUser.role === 'manager') html += '<th></th>';
  html += '</tr>';

  for (let w of workers) {
    const dailyDraws = await db.worker_transactions
      .where('workerId').equals(w.id).and(d => d.date.startsWith(today)).toArray();
    const dailyTotal = dailyDraws.reduce((s, d) => s + d.amount, 0);
    const dailyDetails = dailyDraws.map(d => `${d.amount} ريال (${d.reason})`).join('<br>') || '—';
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
    const monthDraws = await db.worker_transactions
      .where('workerId').equals(w.id).and(d => d.date >= monthStart).toArray();
    const monthTotal = monthDraws.reduce((s, d) => s + d.amount, 0);
    const net = w.salary - monthTotal;
    html += `<tr>
      <td>${w.name}</td><td>${w.phone || '—'}</td><td>${w.salary} ريال</td>
      <td class="worker-daily">${dailyDetails}<br><strong>الإجمالي: ${dailyTotal} ريال</strong></td>
      <td>${monthTotal} ريال</td>
      <td style="color:${net >= 0 ? 'green' : 'red'}">${net} ريال ${net < 0 ? '(باقي على العامل)' : '(باقي للعامل)'}</td>
      ${currentUser.role === 'manager' ? `<td><button class="btn-outline" onclick="addWorkerDraw(${w.id})">➕ سحب</button></td>` : ''}
    </tr>`;
  }
  html += '</table></div>';
  document.getElementById('app').innerHTML = html;
}

function renderAddWorker() {
  document.getElementById('app').innerHTML = `
    <div class="sidebar">${getMenuButtons()}</div>
    <div class="card">
      <h3>➕ إضافة عامل</h3>
      <input type="text" id="workerName" placeholder="اسم العامل">
      <input type="text" id="workerPhone" placeholder="رقم الهاتف">
      <input type="number" id="workerSalary" placeholder="الراتب الشهري">
      <button class="btn" onclick="addWorker()">حفظ</button>
      <button class="btn btn-outline" onclick="renderWorkers()">رجوع</button>
    </div>`;
}

async function addWorker() {
  const name = document.getElementById('workerName').value.trim();
  const phone = document.getElementById('workerPhone').value.trim();
  const salary = +document.getElementById('workerSalary').value;
  if (!name || !salary) return alert('أدخل جميع البيانات');
  await db.workers.add({ name, phone, salary });
  renderWorkers();
}

async function addWorkerDraw(workerId) {
  const amount = prompt('مبلغ السحب:');
  if (!amount || isNaN(amount)) return;
  const reason = prompt('السبب:');
  await db.worker_transactions.add({
    workerId, amount: +amount, reason: reason || '', date: new Date().toISOString()
  });
  renderWorkers();
}

// ========== المخزون (للمدير فقط) ==========
async function renderInventory() {
  if (currentUser.role !== 'manager') return renderDashboard();
  const products = await db.products.toArray();
  let rows = products.map(p => `
    <tr>
      <td>${p.name} (${p.toyotaCode||''})</td><td>${p.sellPrice} ريال</td><td>${p.quantity}</td>
      <td>
        <button class="btn-outline" onclick="editProduct(${p.id})">✏️</button>
        <button class="btn-danger" onclick="deleteProduct(${p.id})">🗑️</button>
      </td>
    </tr>`).join('');
  document.getElementById('app').innerHTML = `
    <div class="sidebar">${getMenuButtons()}</div>
    <div class="card"><h3>📦 المخزون</h3>
      <button class="btn" onclick="renderAddProduct()">➕ إضافة قطعة</button>
      <table><tr><th>القطعة</th><th>السعر</th><th>الكمية</th><th></th></tr>${rows}</table>
    </div>`;
}

function renderAddProduct() {
  if (currentUser.role !== 'manager') return;
  document.getElementById('app').innerHTML = `
    <div class="sidebar">${getMenuButtons()}</div>
    <div class="card"><h3>➕ إضافة قطعة</h3>
      <input type="text" id="prodName" placeholder="اسم القطعة">
      <input type="text" id="toyotaCode" placeholder="كود تويوتا (اختياري)">
      <input type="number" id="prodPrice" placeholder="سعر البيع">
      <input type="number" id="prodQty" placeholder="الكمية">
      <button class="btn" onclick="addProduct()">حفظ</button>
      <button class="btn btn-outline" onclick="renderInventory()">رجوع</button>
    </div>`;
}

async function addProduct() {
  const name = document.getElementById('prodName').value.trim();
  const code = document.getElementById('toyotaCode').value.trim();
  const price = +document.getElementById('prodPrice').value;
  const qty = +document.getElementById('prodQty').value;
  if (!name || !price || !qty) return alert('أدخل البيانات');
  await db.products.add({ name, toyotaCode: code, sellPrice: price, quantity: qty, dateAdded: new Date().toISOString() });
  renderInventory();
}

async function editProduct(id) {
  const p = await db.products.get(id);
  document.getElementById('app').innerHTML = `
    <div class="sidebar">${getMenuButtons()}</div>
    <div class="card"><h3>✏️ تعديل قطعة</h3>
      <input type="text" id="editName" value="${p.name}">
      <input type="text" id="editCode" value="${p.toyotaCode||''}">
      <input type="number" id="editPrice" value="${p.sellPrice}">
      <input type="number" id="editQty" value="${p.quantity}">
      <button class="btn" onclick="updateProduct(${id})">حفظ</button>
      <button class="btn btn-outline" onclick="renderInventory()">رجوع</button>
    </div>`;
}

async function updateProduct(id) {
  const name = document.getElementById('editName').value.trim();
  const code = document.getElementById('editCode').value.trim();
  const price = +document.getElementById('editPrice').value;
  const qty = +document.getElementById('editQty').value;
  await db.products.update(id, { name, toyotaCode: code, sellPrice: price, quantity: qty });
  renderInventory();
}

async function deleteProduct(id) {
  if (confirm('متأكد من حذف القطعة؟')) {
    await db.products.delete(id);
    renderInventory();
  }
}

// ========== المصروفات (مدير فقط) ==========
async function renderExpenses() {
  if (currentUser.role !== 'manager') return renderDashboard();
  const expenses = await db.expenses.toArray();
  let rows = expenses.map(e => `<tr><td>${e.reason}</td><td>${e.amount} ريال</td><td>${e.date.slice(0,10)}</td></tr>`).join('');
  document.getElementById('app').innerHTML = `
    <div class="sidebar">${getMenuButtons()}</div>
    <div class="card"><h3>💸 المصروفات</h3>
      <button class="btn" onclick="renderAddExpense()">➕ تسجيل مصروف</button>
      <table><tr><th>السبب</th><th>المبلغ</th><th>التاريخ</th></tr>${rows || '<tr><td colspan="3">لا توجد مصروفات</td></tr>'}</table>
    </div>`;
}

async function renderAddExpense() {
  document.getElementById('app').innerHTML = `
    <div class="sidebar">${getMenuButtons()}</div>
    <div class="card"><h3>➕ تسجيل مصروف</h3>
      <input type="text" id="expenseReason" placeholder="السبب">
      <input type="number" id="expenseAmount" placeholder="المبلغ">
      <select id="expenseWorker"><option value="">غير مرتبط بعامل</option></select>
      <button class="btn" onclick="addExpense()">حفظ</button>
      <button class="btn btn-outline" onclick="renderExpenses()">رجوع</button>
    </div>`;
  const workers = await db.workers.toArray();
  const sel = document.getElementById('expenseWorker');
  workers.forEach(w => {
    const opt = document.createElement('option');
    opt.value = w.id;
    opt.textContent = w.name;
    sel.appendChild(opt);
  });
}

async function addExpense() {
  const reason = document.getElementById('expenseReason').value.trim();
  const amount = +document.getElementById('expenseAmount').value;
  const workerId = document.getElementById('expenseWorker').value || null;
  if (!reason || !amount) return alert('أدخل البيانات');
  await db.expenses.add({ reason, amount, date: new Date().toISOString(), workerId: workerId ? +workerId : null });
  if (workerId) {
    await db.worker_transactions.add({
      workerId: +workerId, amount, reason: `مصروف: ${reason}`, date: new Date().toISOString()
    });
  }
  renderExpenses();
}

// ========== التقارير (مدير فقط) ==========
async function renderReports() {
  if (currentUser.role !== 'manager') return renderDashboard();
  const today = new Date().toISOString().slice(0,10);
  const sales = await db.transactions.where('date').startsWith(today).toArray();
  const totalSales = sales.reduce((s, t) => s + t.total, 0);
  const expenses = await db.expenses.where('date').startsWith(today).toArray();
  const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0);
  document.getElementById('app').innerHTML = `
    <div class="sidebar">${getMenuButtons()}</div>
    <div class="card"><h3>📑 التقارير</h3>
      <p>📅 تقرير يومي (${today}):</p>
      <p>💰 مبيعات: ${totalSales} ريال</p>
      <p>💸 مصروفات: ${totalExpenses} ريال</p>
      <p>🧾 الصافي: ${totalSales - totalExpenses} ريال</p>
      <button class="btn" onclick="generateMonthlyPDF()">تصدير تقرير شهري PDF</button>
    </div>`;
}

async function generateMonthlyPDF() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(16);
  doc.text("تقرير شهري - محلات طيب علي صالح الأشول", 10, 10);
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString();
  const sales = await db.transactions.where('date').between(monthStart, monthEnd, true, true).toArray();
  const totalSales = sales.reduce((s, t) => s + t.total, 0);
  const expenses = await db.expenses.where('date').between(monthStart, monthEnd, true, true).toArray();
  const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0);
  doc.setFontSize(12);
  doc.text(`إجمالي المبيعات: ${totalSales} ريال`, 10, 20);
  doc.text(`إجمالي المصروفات: ${totalExpenses} ريال`, 10, 30);
  doc.text(`الصافي: ${totalSales - totalExpenses} ريال`, 10, 40);
  // يمكن إضافة جداول لاحقاً
  doc.save(`تقرير_${new Date().toISOString().slice(0,7)}.pdf`);
}

// ========== المزامنة ==========
function renderSync() {
  document.getElementById('app').innerHTML = `
    <div class="sidebar">${getMenuButtons()}</div>
    <div class="card"><h3>🔄 المزامنة</h3>
      ${currentUser.role === 'employee' ? 
        `<p>عند اتصال الجهاز بالإنترنت، اضغط لإرسال بيانات اليوم إلى المدير.</p>
         <button class="btn" onclick="exportDailyJSON()">تصدير بيانات اليوم (JSON)</button>` :
        `<p>استيراد بيانات الموظف (يدمج التحديثات).</p>
         <button class="btn" onclick="document.getElementById('importFile').click()">استيراد ودمج</button>
         <input type="file" id="importFile" accept=".json" onchange="importJSON(this)" style="display:none;">`
      }
    </div>`;
}

async function exportDailyJSON() {
  const today = new Date().toISOString().slice(0,10);
  const data = {
    transactions: await db.transactions.where('date').startsWith(today).toArray(),
    debts_settled: await db.transactions.where('type').equals('debt_settlement').and(tx => tx.date.startsWith(today)).toArray(),
    consignments_returned: await db.transactions.where('type').equals('consignment_return').and(tx => tx.date.startsWith(today)).toArray(),
    worker_draws: await db.worker_transactions.where('date').startsWith(today).toArray(),
    expenses: await db.expenses.where('date').startsWith(today).toArray()
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `employee_day_${today}.json`;
  a.click();
  alert('تم تصدير بيانات اليوم. أرسل الملف إلى المدير.');
}

async function importJSON(input) {
  const file = input.files[0];
  const text = await file.text();
  try {
    const data = JSON.parse(text);
    if (data.transactions) {
      for (let tx of data.transactions) {
        const exists = await db.transactions.get(tx.id);
        if (!exists) await db.transactions.put(tx);
      }
    }
    if (data.debts_settled) {
      for (let settle of data.debts_settled) {
        const exists = await db.transactions.get(settle.id);
        if (!exists) {
          await db.transactions.put(settle);
          const debt = await db.debts.where({ entityName: settle.entityName, amount: settle.total, status: 'unpaid' }).first();
          if (debt) await db.debts.delete(debt.id);
        }
      }
    }
    if (data.consignments_returned) {
      for (let ret of data.consignments_returned) {
        const exists = await db.transactions.get(ret.id);
        if (!exists) {
          await db.transactions.put(ret);
          const cons = await db.consignments.where({ technicianName: ret.entityName, productName: ret.productName, status: 'active' }).first();
          if (cons) await db.consignments.delete(cons.id);
        }
      }
    }
    if (data.worker_draws) {
      for (let draw of data.worker_draws) {
        const exists = await db.worker_transactions.get(draw.id);
        if (!exists) await db.worker_transactions.put(draw);
      }
    }
    if (data.expenses) {
      for (let exp of data.expenses) {
        const exists = await db.expenses.get(exp.id);
        if (!exists) await db.expenses.put(exp);
      }
    }
    alert('✅ تم دمج بيانات الموظف بنجاح');
    renderDashboard();
  } catch (e) {
    alert('❌ خطأ في الملف');
  }
}

// ========== الإطلاق ==========
loadApp();