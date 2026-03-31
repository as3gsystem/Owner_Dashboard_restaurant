// Firebase Configuration (Compat Mode)
const firebaseConfig = {
    apiKey: "AIzaSyBYnje2YLbHsOueAEDxctFHUNT0jUcmHrs",
    authDomain: "restaurants-8ef8a.firebaseapp.com",
    projectId: "restaurants-8ef8a",
    storageBucket: "restaurants-8ef8a.firebasestorage.app",
    messagingSenderId: "316393844904",
    appId: "1:316393844904:web:519ae4a98a195d6228529d",
    measurementId: "G-QSXN02T9V7"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// Application State
let currentTenant = null;
let currentData = null;
let unsubscribe = null;
let mainBranchCode = null;
let allBranches = []; // Global list of all available branches

// UI Elements
const loginOverlay = document.getElementById('login-overlay');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');
const mainDashboard = document.getElementById('main-dashboard');
const navItems = document.querySelectorAll('.nav-item');
const viewSections = document.querySelectorAll('.view-section');

// --- Authentication Logic ---

// Check for saved credentials on load
window.addEventListener('load', () => {
    const savedCode = localStorage.getItem('web_admin_code');
    const savedEmail = localStorage.getItem('web_admin_email');
    const savedPassword = localStorage.getItem('web_admin_password');

    if (savedCode) document.getElementById('restaurant-code').value = savedCode;
    if (savedEmail) document.getElementById('owner-email').value = savedEmail;
    if (savedPassword) document.getElementById('owner-password').value = savedPassword;

    // Optional: Auto-login if all fields are present
    if (savedCode && savedEmail && savedPassword) {
        showToast('جاري تسجيل الدخول التلقائي...', 'info');
        setTimeout(() => loginForm.dispatchEvent(new Event('submit')), 1000);
    }
});

loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = document.getElementById('restaurant-code').value.trim();
    const email = document.getElementById('owner-email').value.trim();
    const password = document.getElementById('owner-password').value.trim();

    showToast('جاري التحقق من البيانات...', 'info');
    
    try {
        const tenantRef = db.collection('tenants').doc(code);
        const doc = await tenantRef.get();
        if (!doc.exists) {
            loginError.textContent = '❌ كود المطعم غير صحيح أو غير مفعل سحابياً.';
            return;
        }

        const data = doc.data();

        // --- Subscription Check ---
        const now = new Date();
        const isExpired = data.webAdminExpiry && new Date(data.webAdminExpiry) < now;
        const isActive = data.isWebAdminActive !== false && !isExpired;

        if (!isActive) {
            document.getElementById('lock-store-code').textContent = code;
            document.getElementById('subscription-overlay').classList.add('active');
            if (isExpired) {
                document.querySelector('#subscription-overlay h2').textContent = '⚠️ انتهت صلاحية الاشتراك';
                document.querySelector('#subscription-overlay p').innerHTML = `انتهى اشتراك لوحة التحكم بتاريخ <strong>${new Date(data.webAdminExpiry).toLocaleDateString('ar-EG')}</strong>.<br>يرجى التجديد للاستمرار في استخدام الخدمة.`;
            }
            return;
        }
        // --------------------------
        const settings = data.settings || {};

        // التحقق من صلاحيات المسؤول السحابي
        if (!settings.webAdminEnabled) {
            loginError.textContent = '❌ الوصول السحابي معطل حالياً من إعدادات الكاشير.';
            return;
        }

        if (!settings.webAdminUser || !settings.webAdminPassword) {
            loginError.textContent = '❌ لم يتم ضبط البريد أو كلمة المرور في إعدادات الكاشير بعد.';
            return;
        }

        const dbUser = settings.webAdminUser.trim().toLowerCase();
        const inputEmail = email.toLowerCase();

        if (dbUser === inputEmail && settings.webAdminPassword === password) {
            // Success - Save to localStorage
            localStorage.setItem('web_admin_code', code);
            localStorage.setItem('web_admin_email', email);
            localStorage.setItem('web_admin_password', password);

            currentTenant = code;
            mainBranchCode = code; // Store the original login code
            currentData = data;
            allBranches = data.branches || [];
            loginOverlay.classList.remove('active');
            mainDashboard.classList.add('active');
            showToast('تم تسجيل الدخول بنجاح! أهلاً بك.', 'success');
            
            // Setup branch selector
            setupBranchSelector();
            
            initializeDashboard();
            listenForUpdates(code);
        } else {
            loginError.textContent = '❌ البريد الإلكتروني أو كلمة المرور غير متوافقة مع إعدادات الكاشير.';
        }
    } catch (err) {
        console.error(err);
        loginError.textContent = '❌ حدث خطأ أثناء الاتصال بالسيرفر. تأكد من الإنترنت.';
    }
});

// --- Dashboard Logic ---

function initializeDashboard() {
    if (!currentData) return;

    // Update Basic Info
    document.querySelectorAll('.store-name-display').forEach(el => {
        el.textContent = currentData.storeName || 'المطعم';
    });
    document.getElementById('last-sync-time').textContent = `آخر مزامنة: ${new Date(currentData.lastSync).toLocaleString('ar-EG')}`;

    // Update Stats
    const stats = currentData.stats || {};
    
    // Revenue
    const revToday = document.getElementById('stat-revenue-today');
    const revTotal = document.getElementById('stat-revenue-total');
    if (revToday) revToday.textContent = `${(stats.todayRevenue || 0).toLocaleString('ar-EG')} ج.م`;
    if (revTotal) revTotal.textContent = `الإجمالي: ${(stats.totalRevenue || 0).toLocaleString('ar-EG')} ج.م`;

    // Orders
    const ordToday = document.getElementById('stat-orders-today');
    const ordTotal = document.getElementById('stat-orders-total');
    if (ordToday) ordToday.textContent = stats.todaySales || 0;
    if (ordTotal) ordTotal.textContent = `الإجمالي: ${stats.totalSales || 0}`;

    // Customers
    const cust = document.getElementById('stat-customers');
    if (cust) cust.textContent = stats.totalCustomers || 0;

    // Kitchen & Shifts
    const kitchen = document.getElementById('stat-pending-kitchen');
    const shifts = document.getElementById('stat-active-shifts');
    if (kitchen) kitchen.textContent = `${stats.pendingKitchen || 0} طلب`;
    if (shifts) shifts.textContent = `ورديات مفتوحة: ${stats.activeShifts || 0}`;

    renderRecentSales();
    renderCharts();
    renderProducts();
    renderCustomers();
    renderKitchenOrders();
    renderAttendance();
    renderInventory();
    renderSuppliers();
    checkInventoryAlerts();
    renderRemoteControl();
    updateSubscriptionBadges();

    // Show empty state overlay if no data at all

    // Show empty state overlay if no data at all
    const hasData = (currentData.sales?.length > 0) || (currentData.products?.length > 0);
    document.getElementById('empty-dashboard-overlay')?.style.display(hasData ? 'none' : 'flex');

    // Auto refresh active view if needed
    const activeViewItem = document.querySelector('.nav-item.active');
    if (activeViewItem) {
        const activeView = activeViewItem.getAttribute('data-view');
        if (activeView === 'expenses') renderExpenses();
        if (activeView === 'shifts') renderShifts();
        if (activeView === 'remote') renderRemoteControl();
        if (activeView === 'inventory') renderInventory();
        if (activeView === 'suppliers') renderSuppliers();
    }
}

// --- New Rendering Helpers ---

function renderCustomers() {
    const tableBody = document.querySelector('#customers-table tbody');
    if (!tableBody) return;
    tableBody.innerHTML = '';
    const customers = currentData.customers || [];
    customers.forEach(c => {
        const row = `<tr>
            <td>${c.name}</td>
            <td>${c.phone}</td>
            <td><span class="badge ${c.type === 'VIP' ? 'badge-warning' : 'badge-success'}">${c.type}</span></td>
            <td>${c.totalOrders || 0}</td>
            <td style="font-weight:bold;">${(c.totalSpent || 0).toFixed(2)} ج.م</td>
            <td class="${c.balance < 0 ? 'text-danger' : ''}">${(c.balance || 0).toFixed(2)} ج.م</td>
        </tr>`;
        tableBody.insertAdjacentHTML('beforeend', row);
    });
}

function renderKitchenOrders() {
    const container = document.getElementById('kitchen-orders-grid');
    if (!container) return;
    container.innerHTML = '';
    const orders = (currentData.kitchenOrders || []).filter(o => o.status !== 'completed');
    
    if (orders.length === 0) {
        container.innerHTML = '<div class="glass-card" style="grid-column: 1/-1; text-align:center; padding: 40px;">لا يوجد طلبات في المطبخ حالياً</div>';
        return;
    }

    orders.forEach(o => {
        const itemsList = (o.items || []).map(i => `<li><span>${i.name}</span> <span>x${i.quantity}</span></li>`).join('');
        const time = new Date(o.createdAt).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
        const card = `
            <div class="kitchen-card ${o.status === 'ready' ? 'ready' : ''}">
                <h4><span>#${o.id.toString().slice(-4)}</span> <small>${time}</small></h4>
                <p><strong>${o.tableName}</strong></p>
                <ul>${itemsList}</ul>
                <div style="font-size: 0.8rem; color: #666;">${o.note || ''}</div>
            </div>
        `;
        container.insertAdjacentHTML('beforeend', card);
    });
}

function renderAttendance() {
    const tableBody = document.querySelector('#attendance-table tbody');
    if (!tableBody) return;
    tableBody.innerHTML = '';
    const attendance = currentData.attendance || [];
    attendance.forEach(a => {
        const row = `<tr>
            <td>${a.employeeName}</td>
            <td>${new Date(a.date).toLocaleDateString('ar-EG')}</td>
            <td>${a.punchIn || '---'}</td>
            <td>${a.punchOut || '---'}</td>
            <td>${a.totalHours || '---'}</td>
        </tr>`;
        tableBody.insertAdjacentHTML('beforeend', row);
    });
}

async function updateProductPrice(productId) {
    const newPrice = parseFloat(document.getElementById(`price-${productId}`).value);
    if (isNaN(newPrice)) return;
    
    showToast('جاري تحديث السعر...', 'info');
    await db.collection('tenants').doc(currentTenant).collection('commands').doc('current').set({
        action: 'UPDATE_PRODUCT',
        productId: productId,
        updates: { price: newPrice },
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
    });
    showToast('✅ تم إرسال أمر تحديث السعر', 'success');
}

async function toggleProductVisibility(productId) {
    showToast('جاري تغيير حالة الظهور...', 'info');
    await db.collection('tenants').doc(currentTenant).collection('commands').doc('current').set({
        action: 'TOGGLE_PRODUCT',
        productId: productId,
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
    });
    showToast('✅ تم إرسال أمر تغيير الحالة', 'success');
}

window.updateProductPrice = updateProductPrice;
window.toggleProductVisibility = toggleProductVisibility;

function renderRemoteControl() {
    renderRemoteUsers();
}

function renderRemoteUsers() {
    const tableBody = document.querySelector('#remote-users-table tbody');
    const selectEl = document.getElementById('remote-user-select');
    
    if (tableBody) tableBody.innerHTML = '';
    if (selectEl) selectEl.innerHTML = '<option value="">-- اختر موظف --</option>';

    const users = currentData.users || [];
    
    users.forEach(u => {
        const roleLabel = u.role === 'admin' ? 'مدير عام' : (u.role === 'manager' ? 'مشرف' : 'كاشير');
        const roleClass = u.role === 'admin' ? 'badge-danger' : (u.role === 'manager' ? 'badge-warning' : 'badge-success');

        if (tableBody) {
            const p = u.permissions || {};
            const permSummary = u.role === 'admin' ? 'كل الصلاحيات' : 
                Object.entries(p).filter(([_, v]) => v).map(([k, _]) => {
                    const map = { tables: 'طاولات', orders: 'طلبات', kitchen: 'مطبخ', shifts: 'ورديات', reports: 'تقارير', products: 'أصناف', inventory: 'مخزن', recipes: 'وصفات', expenses: 'مصاريف', settings: 'إعدادات' };
                    return map[k] || k;
                }).join('، ') || 'لا يوجد';

            const row = `
                <tr>
                    <td>${u.name || '---'}</td>
                    <td>${u.username}</td>
                    <td><span class="badge ${roleClass}">${roleLabel}</span></td>
                    <td style="font-size: 0.8rem; color: #666; max-width: 200px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${permSummary}">
                        ${permSummary}
                    </td>
                    <td>
                        <button class="btn-icon delete-btn" onclick="sendRemoteCommand('DELETE_USER', { userId: '${u.id}' })" title="حذف الحساب">
                            <i class="fas fa-trash-alt"></i>
                        </button>
                    </td>
                </tr>
            `;
            tableBody.insertAdjacentHTML('beforeend', row);
        }

        if (selectEl) {
            selectEl.insertAdjacentHTML('beforeend', `<option value="${u.id}">${u.name} (${roleLabel})</option>`);
        }
    });
}

async function sendRemoteCommand(action) {
    if (!currentTenant) return;
    
    const statusDiv = document.getElementById('remote-status');
    const payload = { 
        action: action, 
        timestamp: firebase.firestore.FieldValue.serverTimestamp() 
    };

    if (action === 'RESET_PASSWORD') {
        const userId = parseInt(document.getElementById('remote-user-select').value);
        const newPass = document.getElementById('remote-new-password').value.trim();
        if (!newPass) {
            showToast('يرجى إدخال كلمة المرور الجديدة', 'warning');
            return;
        }
        payload.userId = userId;
        payload.newPassword = newPass;
    }

    try {
        statusDiv.textContent = '⏳ جاري إرسال الأمر...';
        statusDiv.style.color = '#6c5ce7';
        
        await db.collection('tenants').doc(currentTenant).collection('commands').doc('current').set(payload);
        
        showToast('✅ تم إرسال الأمر بنجاح. سيتم تنفيذه عند أول اتصال للكاشير.', 'success');
        statusDiv.textContent = '✅ تم إرسال الأمر بنجاح';
        statusDiv.style.color = '#00b894';
        
        if (action === 'RESET_PASSWORD') document.getElementById('remote-new-password').value = '';
    } catch (err) {
        console.error(err);
        showToast('❌ فشل إرسال الأمر', 'error');
        statusDiv.textContent = '❌ فشل إرسال الأمر';
        statusDiv.style.color = '#e74c3c';
    }
}

// Make it global for HTML onclick
window.sendRemoteCommand = sendRemoteCommand;

function listenForUpdates(code) {
    if (unsubscribe) unsubscribe();
    let lastBranchesStr = '';
    
    unsubscribe = db.collection('tenants').doc(code).onSnapshot((doc) => {
        if (doc.exists) {
            console.log('🔄 تم تلقي تحديث سحابي مباشر من فرع:', code);
            currentData = doc.data();
            updateLiveStats();
            
            // If this is the main branch, update global branches list
            if (code === mainBranchCode) {
                const branches = currentData.branches || [];
                const branchesStr = JSON.stringify(branches);
                if (branchesStr !== lastBranchesStr) {
                    lastBranchesStr = branchesStr;
                    allBranches = branches;
                    setupBranchSelector();
                }
            } else {
                // For sub-branches, just ensure selector is still updated
                setupBranchSelector();
            }

            // --- Real-time Subscription Check ---
            const now = new Date();
            const isExpired = currentData.webAdminExpiry && new Date(currentData.webAdminExpiry) < now;
            const isActive = currentData.isWebAdminActive !== false && !isExpired;

            if (!isActive) {
                document.getElementById('lock-store-code').textContent = code;
                document.getElementById('subscription-overlay').classList.add('active');
                if (isExpired) {
                    document.querySelector('#subscription-overlay h2').textContent = '⚠️ انتهت صلاحية الاشتراك';
                    document.querySelector('#subscription-overlay p').innerHTML = `انتهى اشتراك لوحة التحكم بتاريخ <strong>${new Date(currentData.webAdminExpiry).toLocaleDateString('ar-EG')}</strong>.<br>يرجى التجديد للاستمرار في استخدام الخدمة.`;
                }
            } else {
                document.getElementById('subscription-overlay').classList.remove('active');
            }
            // ------------------------------------

            updateSubscriptionBadges();
        }
    });
}

function updateSubscriptionBadges() {
    if (!currentData) return;

    const posEl = document.getElementById('sidebar-pos-status');
    const cloudEl = document.getElementById('sidebar-cloud-status');

    if (posEl) {
        const isPosActive = currentData.posActive;
        posEl.className = `badge-status-dot ${isPosActive ? 'green' : 'red'}`;
        posEl.textContent = isPosActive ? 'نشط' : 'مكتوم';
    }

    if (cloudEl) {
        const now = new Date();
        const isExpired = currentData.webAdminExpiry && new Date(currentData.webAdminExpiry) < now;
        const isCloudActive = currentData.isWebAdminActive !== false && !isExpired;
        cloudEl.className = `badge-status-dot ${isCloudActive ? 'green' : 'red'}`;
        cloudEl.textContent = isCloudActive ? 'نشط' : 'معطل';
    }
}

function updateLiveStats() {
    if (!currentData) return;
    const stats = currentData.stats || {};
    
    const revToday = document.getElementById('stat-revenue-today');
    if (revToday) revToday.textContent = `${(stats.todayRevenue || 0).toLocaleString('ar-EG')} ج.م`;
    
    const ordToday = document.getElementById('stat-orders-today');
    if (ordToday) ordToday.textContent = stats.todaySales || 0;
    
    document.getElementById('last-sync-time').textContent = `تحديث مباشر: ${new Date().toLocaleTimeString('ar-EG')}`;
    renderRecentSales();
    renderRemoteControl();
}

function setupBranchSelector() {
    const branchSelect = document.getElementById('branch-select');
    if (!branchSelect) return;
    
    branchSelect.innerHTML = '';
    
    // Add main branch
    const mainOpt = document.createElement('option');
    mainOpt.value = mainBranchCode;
    mainOpt.textContent = `الفرع الرئيسي (${mainBranchCode})`;
    branchSelect.appendChild(mainOpt);
    
    // Add other branches (skipping main code if it's accidentally included)
    allBranches.forEach(branchCode => {
        if (branchCode === mainBranchCode) return;
        const opt = document.createElement('option');
        opt.value = branchCode;
        opt.textContent = `فرع: ${branchCode}`;
        branchSelect.appendChild(opt);
    });

    // Ensure current selection is preserved
    branchSelect.value = currentTenant;
    
    branchSelect.addEventListener('change', async (e) => {
        const selectedCode = e.target.value;
        if (selectedCode === currentTenant) return;
        
        showToast('جاري الانتقال للفرع المحدد...', 'info');
        currentTenant = selectedCode;
        
        try {
            const doc = await db.collection('tenants').doc(selectedCode).get();
            if (doc.exists) {
                currentData = doc.data();
                initializeDashboard();
                listenForUpdates(selectedCode);
            } else {
                showToast('❌ بيانات الفرع غير متوفرة بعد.', 'warning');
            }
        } catch (err) {
            console.error(err);
            showToast('❌ حدث خطأ أثناء التبديل.', 'error');
        }
    });

    const addBtn = document.getElementById('btn-add-branch');
    if (addBtn) {
        addBtn.addEventListener('click', openAddBranchModal);
    }
    
    const searchBtn = document.getElementById('search-branch-btn');
    const confirmBtn = document.getElementById('confirm-add-branch');
    const previewDiv = document.getElementById('branch-info-preview');
    const input = document.getElementById('new-branch-input');
    let verifiedBranchData = null;

    if (searchBtn) {
        searchBtn.onclick = async () => {
            const code = input.value;
            if (!code || !code.trim()) {
                showToast('من فضلك أدخل كود الفرع', 'warning');
                return;
            }
            
            const cleanCode = code.trim().toUpperCase();
            const branches = currentData.branches || [];
            
            if (branches.includes(cleanCode) || cleanCode === mainBranchCode) {
                showToast('هذا الفرع مضاف بالفعل', 'warning');
                return;
            }
            
            searchBtn.disabled = true;
            searchBtn.innerHTML = 'جاري البحث...';
            
            try {
                // Fetch branch info
                const branchDoc = await db.collection('tenants').doc(cleanCode).get();
                if (!branchDoc.exists) {
                    showToast('❌ عذراً، هذا الكود غير مسجل في النظام.', 'error');
                    searchBtn.disabled = false;
                    searchBtn.innerHTML = '🔍 بحث عن الفرع';
                    return;
                }
                
                // Show preview
                verifiedBranchData = branchDoc.data();
                document.getElementById('preview-store-name').textContent = verifiedBranchData.settings?.storeName || 'فرع بدون اسم';
                document.getElementById('preview-store-code').textContent = cleanCode;
                
                previewDiv.style.display = 'block';
                searchBtn.style.display = 'none';
                confirmBtn.style.display = 'block';
                input.disabled = true;
                
            } catch (err) {
                console.error(err);
                showToast('❌ حدث خطأ أثناء الاتصال.', 'error');
                searchBtn.disabled = false;
                searchBtn.innerHTML = '🔍 بحث عن الفرع';
            }
        };
    }

    if (confirmBtn) {
        confirmBtn.onclick = async () => {
            if (!verifiedBranchData) return;
            const code = input.value.trim().toUpperCase();
            
            confirmBtn.disabled = true;
            confirmBtn.innerHTML = 'جاري الإضافة...';
            
            try {
                // Add to main doc
                await db.collection('tenants').doc(mainBranchCode).update({
                    branches: firebase.firestore.FieldValue.arrayUnion(code)
                });
                
                showToast('✅ تم إضافة الفرع بنجاح!', 'success');
                closeAddBranchModal();
            } catch (err) {
                console.error(err);
                showToast('❌ فشل إضافة الفرع.', 'error');
                confirmBtn.disabled = false;
                confirmBtn.innerHTML = '✅ تأكيد ربط الفرع';
            }
        };
    }
}

function openAddBranchModal() {
    document.getElementById('add-branch-modal').classList.add('active');
    const input = document.getElementById('new-branch-input');
    input.value = '';
    input.disabled = false;
    input.focus();
    
    // Reset Modal UI
    document.getElementById('branch-info-preview').style.display = 'none';
    document.getElementById('search-branch-btn').style.display = 'block';
    document.getElementById('search-branch-btn').disabled = false;
    document.getElementById('search-branch-btn').innerHTML = '🔍 بحث عن الفرع';
    document.getElementById('confirm-add-branch').style.display = 'none';
    document.getElementById('confirm-add-branch').disabled = false;
    document.getElementById('confirm-add-branch').innerHTML = '✅ تأكيد ربط الفرع';
}

function closeAddBranchModal() {
    document.getElementById('add-branch-modal').classList.remove('active');
}

window.closeAddBranchModal = closeAddBranchModal;

// --- Navigation ---

navItems.forEach(item => {
    item.addEventListener('click', (e) => {
        if (item.id === 'btn-logout') return;
        e.preventDefault();
        
        const viewId = item.getAttribute('data-view');
        
        // Update Nav UI
        navItems.forEach(i => i.classList.remove('active'));
        item.classList.add('active');

        // Update View UI – re-query to pick up dynamically added sections
        document.querySelectorAll('.view-section').forEach(v => v.classList.remove('active'));
        const targetSection = document.getElementById(`view-${viewId}`);
        if (targetSection) targetSection.classList.add('active');
        else { console.warn('No section found for view:', viewId); return; }

        // Update Title
        const titles = { 
            overview: 'ملخص الأداء العام', 
            sales: 'سجل المبيعات المفصل', 
            expenses: 'سجل المصاريف',
            shifts: 'سجل الورديات',
            products: 'الأصناف والتحكم بالأسعار', 
            customers: 'قائمة العملاء والولاء',
            kitchen: 'مراقب المطبخ المباشر',
            attendance: 'حضور وانصراف الموظفين',
            remote: 'التحكم عن بُعد',
            inventory: 'إدارة المخازن والخامات',
            suppliers: 'إدارة الموردين والحسابات',
            reports: 'التقارير المالية المفصلة'
        };
        document.getElementById('view-title').textContent = titles[viewId] || 'لوحة التحكم';
        
        if (viewId === 'sales') renderFullSales();
        if (viewId === 'expenses') renderExpenses();
        if (viewId === 'shifts') renderShifts();
        if (viewId === 'products') renderProducts();
        if (viewId === 'customers') renderCustomers();
        if (viewId === 'kitchen') renderKitchenOrders();
        if (viewId === 'attendance') renderAttendance();
        if (viewId === 'remote') renderRemoteControl();
        if (viewId === 'inventory') renderInventory();
        if (viewId === 'suppliers') renderSuppliers();
        if (viewId === 'reports') renderReports();
    });
});

document.getElementById('btn-logout').addEventListener('click', () => {
    localStorage.removeItem('web_admin_password'); // Remove password on logout for security
    window.location.reload();
});

// --- Rendering Helpers ---

function renderReports() {
    const sales = currentData.sales || [];
    const dateFrom = document.getElementById('reports-date-from')?.value;
    const dateTo = document.getElementById('reports-date-to')?.value;
    const userFilter = document.getElementById('reports-user-filter')?.value;

    // Populate user filter dropdown
    const userSelect = document.getElementById('reports-user-filter');
    if (userSelect && userSelect.options.length <= 1) {
        const users = currentData.users || [];
        users.forEach(u => {
            if(![...userSelect.options].some(opt => opt.value === u.name)) {
                userSelect.insertAdjacentHTML('beforeend', `<option value="${u.name}">${u.name}</option>`);
            }
        });
    }

    let cashSales = 0, cardSales = 0, taxSales = 0, nontaxSales = 0;

    sales.forEach(sale => {
        const saleDate = new Date(sale.date);
        saleDate.setHours(0,0,0,0);

        if (dateFrom) {
            const from = new Date(dateFrom);
            from.setHours(0,0,0,0);
            if (saleDate < from) return;
        }

        if (dateTo) {
            const to = new Date(dateTo);
            to.setHours(0,0,0,0);
            if (saleDate > to) return;
        }

        if (userFilter && sale.cashierName !== userFilter) return;

        if (sale.paymentMethod === 'نقدي' || sale.paymentMethod === 'Cash') {
            cashSales += sale.total || 0;
        } else {
            cardSales += sale.total || 0;
        }

        if (sale.vat && sale.vat > 0) {
            taxSales += sale.total || 0;
        } else {
            nontaxSales += sale.total || 0;
        }
    });

    const cashEl = document.getElementById('stat-cash-sales');
    const cardEl = document.getElementById('stat-card-sales');
    const taxEl = document.getElementById('stat-tax-sales');
    const nonTaxEl = document.getElementById('stat-nontax-sales');

    if (cashEl) cashEl.textContent = cashSales.toFixed(2) + ' ج.م';
    if (cardEl) cardEl.textContent = cardSales.toFixed(2) + ' ج.م';
    if (taxEl) taxEl.textContent = taxSales.toFixed(2) + ' ج.م';
    if (nonTaxEl) nonTaxEl.textContent = nontaxSales.toFixed(2) + ' ج.م';
}

// Remote User Management logic moved up for consistency

function showAddUserModal() {
    document.getElementById('add-user-modal').classList.add('active');
    document.getElementById('new-user-name').value = '';
    document.getElementById('new-user-username').value = '';
    document.getElementById('new-user-password').value = '';
    document.getElementById('new-user-role').value = 'cashier';
    updatePermissionsLayout(); // Set default permissions for cashier
}

window.updatePermissionsLayout = () => {
    const role = document.getElementById('new-user-role').value;
    const perms = {
        tables: true,
        orders: true,
        kitchen: role !== 'cashier',
        shifts: role !== 'cashier',
        reports: role === 'admin',
        products: role === 'admin',
        inventory: role === 'admin',
        recipes: role === 'admin',
        expenses: role === 'admin',
        settings: role === 'admin'
    };

    // Apply to checkboxes
    for (const [id, value] of Object.entries(perms)) {
        const el = document.getElementById(`perm-${id}`);
        if (el) el.checked = value;
    }
};

function closeAddUserModal() {
    document.getElementById('add-user-modal').classList.remove('active');
}

window.showAddUserModal = showAddUserModal;
window.closeAddUserModal = closeAddUserModal;

window.sendRemoteCommand = async (action, extras = {}) => {
    if (!currentTenant) return;
    try {
        const commandData = {
            action: action,
            timestamp: new Date().toISOString(),
            ...extras
        };

        if (action === 'RESET_PASSWORD') {
            const userId = document.getElementById('remote-user-select').value;
            const newPassword = document.getElementById('remote-new-password').value;
            if (!userId || !newPassword) {
                showToast('الرجاء اختيار الموظف وكتابة كلمة المرور الجديدة', 'warning');
                return;
            }
            commandData.userId = userId;
            commandData.newPassword = newPassword;
        }

        // Send Command to Firestore
        await db.collection('tenants').doc(currentTenant).collection('commands').doc('current').set(commandData);
        showToast('تم إرسال الأمر بنجاح إلى جهاز الكاشير', 'success');
        
        if (action === 'RESET_PASSWORD') {
            document.getElementById('remote-new-password').value = '';
        }
        
    } catch (e) {
        showToast('حدث خطأ أثناء إرسال الأمر: ' + e.message, 'error');
    }
};

document.getElementById('confirm-add-user')?.addEventListener('click', async () => {
    const name = document.getElementById('new-user-name').value.trim();
    const username = document.getElementById('new-user-username').value.trim();
    const password = document.getElementById('new-user-password').value.trim();
    const role = document.getElementById('new-user-role').value;

    if (!name || !username || !password) {
        showToast('الرجاء تعبئة كافة الحقول!', 'warning');
        return;
    }

    // Collect permissions
    const permissions = {
        tables: document.getElementById('perm-tables').checked,
        orders: document.getElementById('perm-orders').checked,
        kitchen: document.getElementById('perm-kitchen').checked,
        shifts: document.getElementById('perm-shifts').checked,
        reports: document.getElementById('perm-reports').checked,
        products: document.getElementById('perm-products').checked,
        inventory: document.getElementById('perm-inventory').checked,
        recipes: document.getElementById('perm-recipes').checked,
        expenses: document.getElementById('perm-expenses').checked,
        settings: document.getElementById('perm-settings').checked
    };

    const newUser = {
        id: Date.now().toString(),
        name,
        username,
        password,
        role,
        permissions
    };

    const btn = document.getElementById('confirm-add-user');
    btn.disabled = true;
    btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> جاري الإرسال...`;

    await window.sendRemoteCommand('ADD_USER', { user: newUser });
    
    closeAddUserModal();
    btn.disabled = false;
    btn.innerHTML = `حفظ وإرسال للنظام`;
    
    // Optimistic UI Update
    if (!currentData.users) currentData.users = [];
    currentData.users.push(newUser);
    renderRemoteUsers();
});

function renderRecentSales() {
    const tableBody = document.querySelector('#recent-sales-table tbody');
    tableBody.innerHTML = '';
    
    const sales = (currentData.sales || []).slice(-5).reverse();
    
    sales.forEach(sale => {
        const row = `
            <tr>
                <td>#${sale.invoiceNumber || '---'}</td>
                <td>${new Date(sale.date).toLocaleTimeString('ar-EG')}</td>
                <td>${(sale.total || 0).toFixed(2)} ج.م</td>
                <td><span class="badge badge-success">مكتمل</span></td>
            </tr>
        `;
        tableBody.insertAdjacentHTML('beforeend', row);
    });
}

function renderFullSales() {
    const tableBody = document.querySelector('#full-sales-table tbody');
    tableBody.innerHTML = '';
    
    const sales = (currentData.sales || []).reverse();
    
    sales.forEach(sale => {
        const row = `
            <tr>
                <td>${new Date(sale.date).toLocaleDateString('ar-EG')}</td>
                <td>#${sale.invoiceNumber || '---'}</td>
                <td>${sale.cashierName || 'غير معروف'}</td>
                <td>${sale.paymentMethod || 'نقدي'}</td>
                <td style="font-weight:bold;">${(sale.total || 0).toFixed(2)} ج.م</td>
            </tr>
        `;
        tableBody.insertAdjacentHTML('beforeend', row);
    });
}

function renderExpenses() {
    const tableBody = document.querySelector('#expenses-table tbody');
    tableBody.innerHTML = '';
    const expenses = (currentData.expenses || []).reverse();
    expenses.forEach(exp => {
        const row = `<tr>
            <td>${new Date(exp.date).toLocaleDateString('ar-EG')}</td>
            <td>${exp.category || 'عام'}</td>
            <td>${(exp.amount || 0).toFixed(2)} ج.م</td>
            <td>${exp.notes || '---'}</td>
        </tr>`;
        tableBody.insertAdjacentHTML('beforeend', row);
    });
}

function renderShifts() {
    const tableBody = document.querySelector('#shifts-table tbody');
    if (!tableBody) return;
    tableBody.innerHTML = '';
    const shifts = (currentData.shifts || []).reverse();
    
    shifts.forEach(s => {
        const isActive = !s.endTime || s.status === 'active';
        const row = `<tr>
            <td style="display:flex; align-items:center; gap:8px;">
                ${s.cashierName || 'غير معروف'}
                ${isActive ? '<span class="badge-live-pulse">نشط الآن</span>' : ''}
            </td>
            <td>${new Date(s.startTime).toLocaleString('ar-EG')}</td>
            <td>${s.endTime ? new Date(s.endTime).toLocaleString('ar-EG') : '---'}</td>
            <td>${(s.startingCash || 0).toFixed(2)} ج.م</td>
            <td><span class="badge ${isActive ? 'badge-warning' : 'badge-success'}">${isActive ? 'مفتوحة' : 'مغلقة'}</span></td>
            <td>
                <button class="btn-primary" style="padding:5px 10px; font-size:0.8rem; background:var(--secondary-color);" 
                        onclick="showShiftDetails('${s.id}')">
                    🔍 تفاصيل
                </button>
            </td>
        </tr>`;
        tableBody.insertAdjacentHTML('beforeend', row);
    });
}

function showShiftDetails(id) {
    const shift = (currentData.shifts || []).find(s => s.id.toString() === id.toString());
    if (!shift) return;

    const isActive = !shift.endTime || shift.status === 'active';
    const content = document.getElementById('shift-details-content');
    
    // For active shifts, we use the synced stats if available
    const sales = shift.sales || 0;
    const exp = shift.expenses || 0;
    const expected = (shift.startingCash || 0) + sales - exp;

    content.innerHTML = `
        <div class="shift-detail-grid">
            <div class="detail-item"><strong>اسم الكاشير:</strong> <span>${shift.cashierName}</span></div>
            <div class="detail-item"><strong>وقت البدء:</strong> <span>${new Date(shift.startTime).toLocaleString('ar-EG')}</span></div>
            <div class="detail-item"><strong>الحالة:</strong> <span class="badge ${isActive ? 'badge-warning' : 'badge-success'}">${isActive ? 'نشطة' : 'مكتملة'}</span></div>
            <hr style="grid-column: 1/-1; opacity:0.1; margin: 10px 0;">
            <div class="detail-item"><strong>الرصيد الافتتاحي:</strong> <span>${(shift.startingCash || 0).toFixed(2)} ج.م</span></div>
            <div class="detail-item" style="color:var(--success-color)"><strong>المبيعات حتى الآن:</strong> <span>${sales.toFixed(2)} ج.م</span></div>
            <div class="detail-item" style="color:var(--danger-color)"><strong>المصروفات:</strong> <span>${exp.toFixed(2)} ج.م</span></div>
            <div class="detail-item highlight"><strong>المبلغ المتوقع بالدرج:</strong> <span>${expected.toFixed(2)} ج.م</span></div>
            ${!isActive ? `
                <div class="detail-item"><strong>الرصيد الفعلي (عند الإغلاق):</strong> <span>${(shift.endingCash || 0).toFixed(2)} ج.م</span></div>
                <div class="detail-item ${shift.difference < 0 ? 'text-danger' : 'text-success'}"><strong>العجز/الزيادة:</strong> <span>${(shift.difference || 0).toFixed(2)} ج.م</span></div>
            ` : ''}
        </div>
        ${shift.notes ? `<div style="margin-top:20px; padding:10px; background:#f9f9f9; border-radius:8px;"><strong>ملاحظات:</strong><br>${shift.notes}</div>` : ''}
    `;

    document.getElementById('shift-details-modal').classList.add('active');
}

function closeShiftDetailsModal() {
    document.getElementById('shift-details-modal').classList.remove('active');
}

window.showShiftDetails = showShiftDetails;
window.closeShiftDetailsModal = closeShiftDetailsModal;

function renderProducts() {
    const container = document.getElementById('products-list');
    if (!container) return;
    container.innerHTML = '';
    
    const products = currentData.products || [];
    const search = (document.getElementById('product-search')?.value || '').toLowerCase();
    
    products.filter(p => p.name.toLowerCase().includes(search)).forEach(p => {
        const card = `
            <div class="glass-card stat-item">
                <div class="stat-info" style="width: 100%;">
                    <div style="display:flex; justify-content:space-between; align-items:start;">
                        <h4 style="margin:0">${p.name}</h4>
                        <span class="badge ${p.isAvailable !== false ? 'badge-success' : 'badge-danger'}">
                            ${p.isAvailable !== false ? 'متاح' : 'غير متاح'}
                        </span>
                    </div>
                    <div class="product-actions" style="margin-top:15px; border-top:1px solid #eee; padding-top:10px;">
                        <div class="price-edit-group" style="display:flex; gap:5px; margin-bottom:10px;">
                            <input type="number" id="price-${p.id}" value="${p.price}" class="form-control" style="width:80px">
                            <button class="btn-primary" style="padding:5px 10px; font-size:0.8rem" onclick="updateProductPrice(${p.id})">💰 تحديث السعر</button>
                        </div>
                        <button class="toggle-btn ${p.isAvailable !== false ? 'on' : 'off'}" style="width:100%" onclick="toggleProductVisibility(${p.id})">
                            ${p.isAvailable !== false ? '📦 إخفاء من المنيو' : '👁️ إظهار في المنيو'}
                        </button>
                    </div>
                    <small style="display:block; margin-top:10px;">القسم: ${currentData.categories?.find(c => c.id === p.categoryId)?.name || 'عام'}</small>
                </div>
            </div>
        `;
        container.insertAdjacentHTML('beforeend', card);
    });
}

function renderFullSales() {
    const tableBody = document.querySelector('#full-sales-table tbody');
    if (!tableBody) return;
    tableBody.innerHTML = '';
    
    const search = (document.getElementById('sales-search')?.value || '').toLowerCase();
    const sales = (currentData.sales || []).filter(s => 
        (s.invoiceNumber || '').toString().includes(search) || 
        (s.cashierName || '').toLowerCase().includes(search)
    ).reverse();
    
    sales.forEach(sale => {
        const row = `
            <tr>
                <td>${new Date(sale.date).toLocaleDateString('ar-EG')}</td>
                <td>#${sale.invoiceNumber || '---'}</td>
                <td>${sale.cashierName || 'غير معروف'}</td>
                <td>${sale.paymentMethod || 'نقدي'}</td>
                <td style="font-weight:bold;">${(sale.total || 0).toFixed(2)} ج.م</td>
            </tr>
        `;
        tableBody.insertAdjacentHTML('beforeend', row);
    });
}

function renderStaff() {
    const container = document.getElementById('staff-list');
    container.innerHTML = '';
    
    const users = currentData.users || [];
    
    users.forEach(u => {
        const card = `
            <div class="glass-card stat-item">
                <div class="stat-icon bg-blue"><i class="fas fa-user"></i></div>
                <div class="stat-info">
                    <h4>${u.name}</h4>
                    <p>${u.role === 'admin' ? 'مدير' : 'كاشير'}</p>
                    <small>Username: ${u.username}</small>
                </div>
            </div>
        `;
        container.insertAdjacentHTML('beforeend', card);
    });
}

// --- Charts Logic ---

let salesChart = null;
let topProductsChart = null;

function renderCharts() {
    renderSalesChart();
    renderTopProductsChart();
}

function renderSalesChart() {
    const ctxSalesEl = document.getElementById('salesChart');
    if (!ctxSalesEl) return;

    const ctxSales = ctxSalesEl.getContext('2d');
    const sales = currentData.sales || [];
    
    const getISODate = (d) => {
        const date = new Date(d);
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    };

    const today = new Date();
    const last7Days = {};
    const labels = [];
    
    for(let i=6; i>=0; i--) {
        const d = new Date();
        d.setDate(today.getDate() - i);
        const iso = getISODate(d);
        last7Days[iso] = 0;
        labels.push(d.toLocaleDateString('ar-EG', { day: 'numeric', month: 'short' }));
    }
    
    sales.forEach(s => {
        const iso = getISODate(s.date);
        if (last7Days[iso] !== undefined) {
            last7Days[iso] += s.total || 0;
        }
    });

    const hasSales = Object.values(last7Days).some(v => v > 0);
    const salesChartContainer = ctxSalesEl.parentElement;
    
    // Clear any previous empty message
    const oldMsg = salesChartContainer.querySelector('.empty-chart-msg');
    if (oldMsg) oldMsg.remove();

    if (!hasSales) {
        salesChartContainer.insertAdjacentHTML('beforeend', '<div class="empty-chart-msg" style="position:absolute; top:50%; left:50%; transform:translate(-50%, -50%); color:#95a5a6; font-size:0.9rem;">لا توجد بيانات مبيعات لآخر 7 أيام</div>');
    }

    if (salesChart) salesChart.destroy();
    salesChart = new Chart(ctxSales, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'المبيعات اليومية',
                data: Object.values(last7Days),
                borderColor: '#2e86de',
                backgroundColor: 'rgba(46, 134, 222, 0.1)',
                tension: 0.4,
                fill: true,
                pointBackgroundColor: '#2e86de',
                pointBorderColor: '#fff',
                pointHoverRadius: 6
            }]
        },
        options: { 
            responsive: true, 
            maintainAspectRatio: false,
            plugins: { 
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(45, 52, 54, 0.9)',
                    titleFont: { family: 'Cairo' },
                    bodyFont: { family: 'Cairo' }
                }
            },
            scales: {
                y: { 
                    beginAtZero: true, 
                    grid: { color: 'rgba(0,0,0,0.05)' }, 
                    min: 0, 
                    suggestedMax: hasSales ? undefined : 100 
                },
                x: { grid: { display: false } }
            }
        }
    });
}

function renderTopProductsChart() {
    const ctxProductsEl = document.getElementById('topProductsChart');
    if (!ctxProductsEl) return;

    const ctxProducts = ctxProductsEl.getContext('2d');
    const sales = currentData.sales || [];
    const productSales = {};
    sales.forEach(s => {
        (s.items || []).forEach(item => {
            productSales[item.name] = (productSales[item.name] || 0) + (item.quantity || 0);
        });
    });

    const top5 = Object.entries(productSales)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);

    const productLabels = top5.length ? top5.map(x => x[0]) : ['في انتظار أول مبيعات...'];
    const productData = top5.length ? top5.map(x => x[1]) : [100];
    const colors = top5.length ? ['#2e86de', '#1dd1a1', '#ff9f43', '#48dbfb', '#ff6b6b'] : ['#f0f2f5'];

    if (topProductsChart) topProductsChart.destroy();
    topProductsChart = new Chart(ctxProducts, {
        type: 'doughnut',
        data: {
            labels: productLabels,
            datasets: [{
                data: productData,
                backgroundColor: colors,
                borderWidth: 0,
                hoverOffset: 10
            }]
        },
        options: { 
            responsive: true, 
            cutout: '75%', 
            plugins: { 
                legend: { 
                    position: 'bottom',
                    labels: {
                        font: { family: 'Cairo', size: 11 },
                        usePointStyle: true,
                        padding: 15
                    }
                },
                tooltip: {
                    enabled: top5.length > 0
                }
            }
        }
    });
}

function checkInventoryAlerts() {
    const products = currentData.products || [];
    const lowStock = products.filter(p => p.stock !== undefined && p.stock <= (p.minStock || 5));
    if (lowStock.length > 0) {
        showToast(`⚠️ تنبيه: يوجد ${lowStock.length} أصناف وصلت للحد الأدنى للمخزون!`, 'warning');
    }
}

// --- Utility ---

function showToast(msg, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<span>${msg}</span>`;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

// WhatsApp Report
document.getElementById('btn-whatsapp-report').addEventListener('click', () => {
    if (!currentData) return;
    const stats = currentData.stats || {};
    const text = `📊 *تقرير مبيعات يومي - ${currentData.storeName}* \n` +
                 `📅 التاريخ: ${new Date().toLocaleDateString('ar-EG')}\n` +
                 `--------------------------\n` +
                 `💰 إجمالي المبيعات: ${stats.totalRevenue.toLocaleString('ar-EG')} ج.م\n` +
                 `🛒 عدد الطلبات: ${stats.totalSales}\n` +
                 `👥 عملاء جدد: ${stats.totalCustomers}\n` +
                 `💸 مصروفات اليوم: ${(currentData.expenses?.length || 0)} بند\n` +
                 `--------------------------\n` +
                 `✅ تم التوليد تلقائياً من نظام الإدارة السحابي.`;
                 
    const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank');
});

function renderInventory() {
    const tableBody = document.querySelector('#inventory-table tbody');
    if (!tableBody) return;
    tableBody.innerHTML = '';
    const materials = currentData.rawMaterials || [];
    
    materials.forEach(m => {
        const isLow = m.stock <= (m.minStock || 5);
        const row = `<tr>
            <td>${m.name}</td>
            <td style="font-weight:bold; color:${isLow ? 'var(--danger-color)' : 'inherit'}">${(m.stock || 0).toFixed(2)}</td>
            <td>${m.unit || 'كجم'}</td>
            <td>${m.minStock || 5}</td>
            <td><span class="badge ${isLow ? 'badge-danger' : 'badge-success'}">${isLow ? 'منخفض' : 'جيد'}</span></td>
            <td>
                <button class="btn-primary" style="padding:5px; font-size:0.75rem; background:var(--secondary-color);" onclick="showRecipeModal('${m.id}')"><i class="fas fa-mortar-pestle"></i></button>
                <button class="btn-primary" style="padding:5px; font-size:0.75rem;" onclick="editMaterial('${m.id}')"><i class="fas fa-edit"></i></button>
            </td>
        </tr>`;
        tableBody.insertAdjacentHTML('beforeend', row);
    });
}

function renderSuppliers() {
    const tableBody = document.querySelector('#suppliers-table tbody');
    if (!tableBody) return;
    tableBody.innerHTML = '';
    const suppliers = currentData.suppliers || [];
    let totalDebt = 0;

    suppliers.forEach(s => {
        const debt = s.totalDebt || 0;
        totalDebt += debt;
        const row = `<tr>
            <td>${s.name}</td>
            <td>${s.phone || '---'}</td>
            <td style="font-weight:bold; color:var(--danger-color)">${debt.toFixed(2)} ج.م</td>
            <td>
                <button class="btn-primary" style="padding:5px; font-size:0.75rem; background:var(--orange-color);" onclick="showSupplierInvoices('${s.id}')"><i class="fas fa-file-invoice-dollar"></i> فواتير</button>
            </td>
        </tr>`;
        tableBody.insertAdjacentHTML('beforeend', row);
    });

    const statDebt = document.getElementById('stat-total-debt');
    if (statDebt) statDebt.textContent = `${totalDebt.toLocaleString('ar-EG')} ج.م`;
}

// --- Inventory & Supplier Modals ---

window.showAddMaterialModal = () => {
    const html = `
    <div id="add-material-overlay" class="overlay active" onclick="if(event.target===this)this.remove()">
        <div class="modal-box glass-card" style="max-width:480px;width:95%;border-radius:16px;padding:30px;">
            <h3 style="margin-bottom:20px;color:var(--primary-color)"><i class="fas fa-plus-circle"></i> إضافة خامة جديدة</h3>
            <div style="display:grid;gap:14px">
                <input id="m-name" class="form-input" placeholder="اسم الخامة *" style="padding:12px;border:2px solid #e0e6ff;border-radius:10px;font-family:Cairo;font-size:15px;width:100%;box-sizing:border-box">
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
                    <select id="m-unit" class="form-input" style="padding:12px;border:2px solid #e0e6ff;border-radius:10px;font-family:Cairo;font-size:15px">
                        <option value="كجم">كجم</option><option value="جرام">جرام</option>
                        <option value="لتر">لتر</option><option value="مل">مل</option>
                        <option value="قطعة">قطعة</option><option value="كرتونة">كرتونة</option>
                    </select>
                    <input id="m-stock" class="form-input" type="number" placeholder="رصيد افتتاحي" value="0" style="padding:12px;border:2px solid #e0e6ff;border-radius:10px;font-family:Cairo;font-size:15px;width:100%;box-sizing:border-box">
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
                    <input id="m-minstock" class="form-input" type="number" placeholder="الحد الأدنى للتنبيه" value="5" style="padding:12px;border:2px solid #e0e6ff;border-radius:10px;font-family:Cairo;font-size:15px;width:100%;box-sizing:border-box">
                    <input id="m-cost" class="form-input" type="number" placeholder="التكلفة لكل وحدة" value="0" style="padding:12px;border:2px solid #e0e6ff;border-radius:10px;font-family:Cairo;font-size:15px;width:100%;box-sizing:border-box">
                </div>
                <input id="m-category" class="form-input" placeholder="الفئة (مثل: لحوم، زيوت)" value="خامات" style="padding:12px;border:2px solid #e0e6ff;border-radius:10px;font-family:Cairo;font-size:15px;width:100%;box-sizing:border-box">
            </div>
            <div style="display:flex;gap:10px;margin-top:20px;justify-content:flex-end">
                <button onclick="document.getElementById('add-material-overlay').remove()" style="padding:10px 20px;border:2px solid #ddd;border-radius:10px;background:white;cursor:pointer;font-family:Cairo">إلغاء</button>
                <button onclick="saveMaterial()" class="btn-primary" style="padding:10px 24px"><i class="fas fa-save"></i> حفظ الخامة</button>
            </div>
        </div>
    </div>`;
    document.body.insertAdjacentHTML('beforeend', html);
};

window.saveMaterial = () => {
    const name = document.getElementById('m-name').value.trim();
    if (!name) { showToast('أدخل اسم الخامة أولاً', 'warning'); return; }
    const material = {
        id: Date.now(),
        name,
        unit: document.getElementById('m-unit').value,
        stock: parseFloat(document.getElementById('m-stock').value) || 0,
        minStock: parseFloat(document.getElementById('m-minstock').value) || 5,
        cost: parseFloat(document.getElementById('m-cost').value) || 0,
        category: document.getElementById('m-category').value || 'خامات'
    };
    // Write to Firestore under the tenant
    const tenantRef = db.collection('tenants').doc(currentTenant);
    const existing = currentData.rawMaterials || [];
    const updated = [...existing, material];
    tenantRef.update({ rawMaterials: updated }).then(() => {
        showToast(`✅ تمت إضافة "${material.name}" للمخزون`, 'success');
        document.getElementById('add-material-overlay').remove();
    }).catch(e => showToast('❌ ' + e.message, 'error'));
};

window.editMaterial = (id) => {
    const m = (currentData.rawMaterials || []).find(m => m.id.toString() === id.toString());
    if (!m) return;
    const html = `
    <div id="edit-material-overlay" class="overlay active" onclick="if(event.target===this)this.remove()">
        <div class="modal-box glass-card" style="max-width:480px;width:95%;border-radius:16px;padding:30px;">
            <h3 style="margin-bottom:20px;color:var(--primary-color)"><i class="fas fa-edit"></i> تعديل: ${m.name}</h3>
            <div style="display:grid;gap:14px">
                <label style="font-weight:bold;color:#555">تعديل الكمية الحالية</label>
                <div style="display:flex;gap:10px">
                    <select id="em-type" style="padding:10px;border:2px solid #e0e6ff;border-radius:10px;font-family:Cairo;flex:1">
                        <option value="add">➕ إضافة كمية</option>
                        <option value="remove">➖ خصم كمية</option>
                        <option value="set">🔄 تعيين الكميه مباشرة</option>
                    </select>
                    <input id="em-qty" type="number" placeholder="الكمية" value="0" style="padding:10px;border:2px solid #e0e6ff;border-radius:10px;font-family:Cairo;flex:1;width:100%;box-sizing:border-box">
                </div>
                <p style="margin:0;color:#888;font-size:0.9rem">المخزون الحالي: <strong>${m.stock} ${m.unit}</strong> | الحد الأدنى: ${m.minStock}</p>
            </div>
            <div style="display:flex;gap:10px;margin-top:20px;justify-content:flex-end">
                <button onclick="document.getElementById('edit-material-overlay').remove()" style="padding:10px 20px;border:2px solid #ddd;border-radius:10px;background:white;cursor:pointer;font-family:Cairo">إلغاء</button>
                <button onclick="updateMaterialStock('${m.id}')" class="btn-primary" style="padding:10px 24px"><i class="fas fa-save"></i> تحديث</button>
            </div>
        </div>
    </div>`;
    document.body.insertAdjacentHTML('beforeend', html);
};

window.updateMaterialStock = (id) => {
    const type = document.getElementById('em-type').value;
    const qty = parseFloat(document.getElementById('em-qty').value) || 0;
    const materials = [...(currentData.rawMaterials || [])];
    const idx = materials.findIndex(m => m.id.toString() === id.toString());
    if (idx === -1) return;
    if (type === 'add') materials[idx].stock += qty;
    else if (type === 'remove') materials[idx].stock = Math.max(0, materials[idx].stock - qty);
    else materials[idx].stock = qty;
    db.collection('tenants').doc(currentTenant).update({ rawMaterials: materials }).then(() => {
        showToast('✅ تم تحديث المخزون', 'success');
        document.getElementById('edit-material-overlay').remove();
    }).catch(e => showToast('❌ ' + e.message, 'error'));
};

window.showAddSupplierModal = () => {
    const html = `
    <div id="add-supplier-overlay" class="overlay active" onclick="if(event.target===this)this.remove()">
        <div class="modal-box glass-card" style="max-width:500px;width:95%;border-radius:16px;padding:30px;">
            <h3 style="margin-bottom:20px;color:var(--primary-color)"><i class="fas fa-user-plus"></i> إضافة مورد جديد</h3>
            <div style="display:grid;gap:14px">
                <input id="s-name" class="form-input" placeholder="اسم المورد *" style="padding:12px;border:2px solid #e0e6ff;border-radius:10px;font-family:Cairo;font-size:15px;width:100%;box-sizing:border-box">
                <input id="s-phone" class="form-input" placeholder="رقم الهاتف *" type="tel" style="padding:12px;border:2px solid #e0e6ff;border-radius:10px;font-family:Cairo;font-size:15px;width:100%;box-sizing:border-box">
                <input id="s-email" class="form-input" placeholder="البريد الإلكتروني" type="email" style="padding:12px;border:2px solid #e0e6ff;border-radius:10px;font-family:Cairo;font-size:15px;width:100%;box-sizing:border-box">
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
                    <select id="s-category" style="padding:12px;border:2px solid #e0e6ff;border-radius:10px;font-family:Cairo;font-size:15px">
                        <option>عام</option><option>لحوم ودواجن</option><option>خضروات وفواكه</option>
                        <option>أسماك</option><option>مخبوزات</option><option>مشروبات</option>
                        <option>منظفات</option><option>معدات</option><option>أخرى</option>
                    </select>
                    <input id="s-balance" class="form-input" type="number" placeholder="رصيد افتتاحي (مديونية)" value="0" step="0.01" style="padding:12px;border:2px solid #e0e6ff;border-radius:10px;font-family:Cairo;font-size:15px;width:100%;box-sizing:border-box">
                </div>
                <textarea id="s-notes" placeholder="ملاحظات" style="padding:12px;border:2px solid #e0e6ff;border-radius:10px;font-family:Cairo;font-size:15px;resize:vertical" rows="2"></textarea>
            </div>
            <div style="display:flex;gap:10px;margin-top:20px;justify-content:flex-end">
                <button onclick="document.getElementById('add-supplier-overlay').remove()" style="padding:10px 20px;border:2px solid #ddd;border-radius:10px;background:white;cursor:pointer;font-family:Cairo">إلغاء</button>
                <button onclick="saveSupplier()" class="btn-primary" style="padding:10px 24px"><i class="fas fa-save"></i> حفظ المورد</button>
            </div>
        </div>
    </div>`;
    document.body.insertAdjacentHTML('beforeend', html);
};

window.saveSupplier = () => {
    const name = document.getElementById('s-name').value.trim();
    const phone = document.getElementById('s-phone').value.trim();
    if (!name || !phone) { showToast('أدخل اسم ورقم هاتف المورد', 'warning'); return; }
    const supplier = {
        id: Date.now(),
        name,
        phone,
        email: document.getElementById('s-email').value.trim(),
        category: document.getElementById('s-category').value,
        balance: parseFloat(document.getElementById('s-balance').value) || 0,
        notes: document.getElementById('s-notes').value.trim(),
        totalDebt: parseFloat(document.getElementById('s-balance').value) || 0,
        createdAt: new Date().toISOString()
    };
    const existing = currentData.suppliers || [];
    const updated = [supplier, ...existing];
    db.collection('tenants').doc(currentTenant).update({ suppliers: updated }).then(() => {
        showToast(`✅ تمت إضافة المورد "${supplier.name}"`, 'success');
        document.getElementById('add-supplier-overlay').remove();
    }).catch(e => showToast('❌ ' + e.message, 'error'));
};

window.showSupplierInvoices = (id) => {
    const s = (currentData.suppliers || []).find(s => s.id.toString() === id.toString());
    if (!s) return;
    const html = `
    <div id="invoices-overlay" class="overlay active" onclick="if(event.target===this)this.remove()">
        <div class="modal-box glass-card" style="max-width:550px;width:95%;border-radius:16px;padding:30px;">
            <h3 style="margin-bottom:5px;color:var(--primary-color)"><i class="fas fa-file-invoice-dollar"></i> فواتير: ${s.name}</h3>
            <p style="color:var(--danger-color);font-weight:bold;margin-top:5px">المديونية الحالية: ${(s.totalDebt||0).toFixed(2)} ج.م</p>
            <hr style="opacity:0.1;margin:15px 0">
            <h4 style="margin-bottom:15px">تسجيل فاتورة / سداد</h4>
            <div style="display:grid;gap:12px">
                <div style="display:flex;gap:10px">
                    <select id="inv-type" style="padding:10px;border:2px solid #e0e6ff;border-radius:10px;font-family:Cairo;flex:1">
                        <option value="invoice">📄 فاتورة مشتريات (+ مديونية)</option>
                        <option value="payment">💰 سداد جزئي (- مديونية)</option>
                    </select>
                    <input id="inv-amount" type="number" placeholder="المبلغ" step="0.01" style="padding:10px;border:2px solid #e0e6ff;border-radius:10px;font-family:Cairo;flex:1;width:100%;box-sizing:border-box">
                </div>
                <input id="inv-note" placeholder="ملاحظات (اختياري)" style="padding:10px;border:2px solid #e0e6ff;border-radius:10px;font-family:Cairo;width:100%;box-sizing:border-box">
            </div>
            <div style="display:flex;gap:10px;margin-top:20px;justify-content:flex-end">
                <button onclick="document.getElementById('invoices-overlay').remove()" style="padding:10px 20px;border:2px solid #ddd;border-radius:10px;background:white;cursor:pointer;font-family:Cairo">إغلاق</button>
                <button onclick="recordSupplierTransaction('${s.id}')" class="btn-primary" style="padding:10px 24px"><i class="fas fa-check"></i> تسجيل</button>
            </div>
        </div>
    </div>`;
    document.body.insertAdjacentHTML('beforeend', html);
};

window.recordSupplierTransaction = (id) => {
    const type = document.getElementById('inv-type').value;
    const amount = parseFloat(document.getElementById('inv-amount').value) || 0;
    if (amount <= 0) { showToast('أدخل مبلغاً صحيحاً', 'warning'); return; }
    const suppliers = [...(currentData.suppliers || [])];
    const idx = suppliers.findIndex(s => s.id.toString() === id.toString());
    if (idx === -1) return;
    if (type === 'invoice') suppliers[idx].totalDebt = (suppliers[idx].totalDebt || 0) + amount;
    else suppliers[idx].totalDebt = Math.max(0, (suppliers[idx].totalDebt || 0) - amount);
    // Save invoice log
    const invoices = currentData.supplierInvoices || [];
    invoices.unshift({ id: Date.now(), supplierId: id, type, amount, note: document.getElementById('inv-note').value, date: new Date().toISOString() });
    db.collection('tenants').doc(currentTenant).update({ suppliers, supplierInvoices: invoices.slice(0, 200) }).then(() => {
        showToast(`✅ تم التسجيل بنجاح`, 'success');
        document.getElementById('invoices-overlay').remove();
    }).catch(e => showToast('❌ ' + e.message, 'error'));
};

window.showRecipeModal = (materialId) => {
    showToast('💡 إدارة الوصفات متاحة من نظام الكاشير (RecipesPage)', 'info');
};

const prodSearch = document.getElementById('product-search');
if (prodSearch) prodSearch.addEventListener('input', renderProducts);

const salesSearch = document.getElementById('sales-search');
if (salesSearch) salesSearch.addEventListener('input', renderFullSales);

document.getElementById('btn-refresh').addEventListener('click', () => {
    if (currentTenant) {
        showToast('جاري تحديث البيانات...', 'info');
        db.collection('tenants').doc(currentTenant).get().then(doc => {
            currentData = doc.data();
            initializeDashboard();
        });
    }
});
