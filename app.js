/* ================= 全局配置与状态 ================= */
// 【配置】你的云端 Worker 接口地址 (请确保结尾没有斜杠)
const WORKER_API_URL = "https://finance-api.gyy124090135.workers.dev";

let state = {
    balance: 0.00,
    lastUpdated: "连接云端中...",
    currentCashier: "连接云端中...",
    transactions: [],
    activeKeyHash: null,
    masterKeyHash: null
};

/* ================= 核心密码学与网络同步 ================= */
async function hashString(str) {
    if (!str) return null;
    const buffer = new TextEncoder().encode(str);
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// 启动时：从云端拉取全局账本
async function initSystem() {
    try {
        const response = await fetch(`${WORKER_API_URL}/ledger`);
        if (response.ok) {
            state = await response.json();
        } else {
            console.error("云端账本加载失败，请检查 Worker 状态");
        }
    } catch (e) {
        alert("无法连接到云端数据库，请检查您的网络！");
    }
    
    updateUI();
    
    // 自动登录态恢复
    if (localStorage.getItem('club_logged_in') === 'true') {
        document.getElementById('admin-actions').classList.remove('hidden');
        document.getElementById('btn-login').classList.add('hidden');
    }
}

// 保存时：推送到云端全局账本
async function saveData() {
    try {
        const response = await fetch(`${WORKER_API_URL}/ledger`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(state)
        });
        
        if (!response.ok) throw new Error('同步失败');
        
        updateUI();
        return true;
    } catch (e) {
        alert("数据同步到云端失败，请检查网络配置！");
        return false;
    }
}

function updateUI() {
    const balanceEl = document.getElementById('display-balance');
    balanceEl.innerText = `¥ ${state.balance.toLocaleString('zh-CN', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
    document.getElementById('display-time').innerText = state.lastUpdated;
    document.getElementById('display-cashier').innerText = state.currentCashier;
}

function openModal(id) {
    document.getElementById(id).classList.remove('hidden');
    if (id === 'ledger-modal') renderLedger();
}

function closeModal(id) { 
    document.getElementById(id).classList.add('hidden'); 
}

/* ================= 动态生成交接密钥 ================= */
function generateRandomKey() {
    const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
    let key = '';
    for(let i=0; i<9; i++) {
        const randomValues = new Uint32Array(1);
        crypto.getRandomValues(randomValues);
        key += chars[randomValues[0] % chars.length];
    }
    return `${key.slice(0,3)}-${key.slice(3,6)}-${key.slice(6,9)}`;
}

function generateAndShowKey() {
    const newKey = generateRandomKey();
    document.getElementById('generated-key-display').innerText = newKey;
    openModal('key-generator-modal');
}

function copyGeneratedKey() {
    const key = document.getElementById('generated-key-display').innerText;
    navigator.clipboard.writeText(key).then(() => {
        const btn = document.getElementById('copy-key-btn');
        const originalText = btn.innerHTML;
        btn.innerHTML = '✅ 复制成功';
        btn.classList.add('bg-emerald-500');
        btn.classList.remove('bg-indigo-600');
        setTimeout(() => {
            btn.innerHTML = originalText;
            btn.classList.remove('bg-emerald-500');
            btn.classList.add('bg-indigo-600');
        }, 2000);
    }).catch(err => alert('剪贴板写入失败，请手动选择复制。'));
}

/* ================= 登录与权限控制 ================= */
function handleLoginClick() {
    if(localStorage.getItem('club_logged_in') === 'true') return;
    openModal('login-modal');
}

async function submitLogin() {
    const name = document.getElementById('login-name').value.trim();
    const key = document.getElementById('login-key').value.trim();
    if (!key) return alert('请输入密钥');

    const hashedKey = await hashString(key);
    
    // 安全验证：对比云端下发的 Hash
    if (hashedKey === state.masterKeyHash) {
        localStorage.setItem('club_user_role', 'master');
    } else if (hashedKey === state.activeKeyHash && name === state.currentCashier) {
        localStorage.setItem('club_user_role', 'cashier');
    } else {
        return alert('登录失败：密钥错误，或姓名与当前出纳不匹配！');
    }

    localStorage.setItem('club_logged_in', 'true');
    closeModal('login-modal');
    document.getElementById('admin-actions').classList.remove('hidden');
    document.getElementById('btn-login').classList.add('hidden');
    
    document.getElementById('login-name').value = '';
    document.getElementById('login-key').value = '';
}

function logout() {
    localStorage.removeItem('club_logged_in');
    localStorage.removeItem('club_user_role');
    document.getElementById('admin-actions').classList.add('hidden');
    document.getElementById('btn-login').classList.remove('hidden');
}

/* ================= 注册交接 ================= */
let warningTimer;
function startRegisterFlow() {
    openModal('warning-modal');
    const btn = document.getElementById('btn-warning-confirm');
    btn.disabled = true;
    btn.classList.add('opacity-50', 'cursor-not-allowed');
    let timeLeft = 5;
    btn.innerText = `阅读中 (${timeLeft})`;
    
    warningTimer = setInterval(() => {
        timeLeft--;
        btn.innerText = `阅读中 (${timeLeft})`;
        if (timeLeft <= 0) {
            clearInterval(warningTimer);
            btn.disabled = false;
            btn.classList.remove('opacity-50', 'cursor-not-allowed');
            btn.innerText = "我已阅读并确认";
            btn.onclick = () => {
                closeModal('warning-modal');
                openModal('transfer-modal');
            };
        }
    }, 1000);
}

async function submitTransfer() {
    const oldName = document.getElementById('old-name').value.trim();
    const oldKey = document.getElementById('old-key').value.trim();
    const newName = document.getElementById('new-name').value.trim();
    const newKey = document.getElementById('new-key').value.trim();

    if (!oldKey || !newName || !newKey) return alert('必填信息不完整');

    const hashedOld = await hashString(oldKey);
    let isAuthorized = false;

    if (hashedOld === state.masterKeyHash) {
        isAuthorized = true;
    } else if (hashedOld === state.activeKeyHash && oldName === state.currentCashier) {
        isAuthorized = true;
    }

    if (!isAuthorized) {
        return alert('授权失败：现任出纳姓名或密钥错误！');
    }

    // 覆盖新哈希并同步云端
    state.activeKeyHash = await hashString(newKey);
    state.currentCashier = newName;
    state.lastUpdated = new Date().toLocaleString('zh-CN');
    
    const success = await saveData();
    
    if (success) {
        logout();
        closeModal('transfer-modal');
        ['old-name', 'old-key', 'new-name', 'new-key'].forEach(id => document.getElementById(id).value = '');
        alert(`权限移交成功！\n新出纳已更新为：${newName}\n旧密钥已永久作废，系统已自动退出登录，请新出纳重新登录。`);
    }
}

/* ================= 云端动账逻辑 ================= */
async function uploadFilesToCloud(files) {
    const uploadedUrls = [];
    for (let i = 0; i < files.length; i++) {
        const formData = new FormData();
        formData.append("file", files[i]);

        const response = await fetch(`${WORKER_API_URL}/upload`, {
            method: "POST",
            body: formData
        });

        if (!response.ok) throw new Error(`网络请求失败 (状态码: ${response.status})`);

        const data = await response.json();
        if (data.success) {
            uploadedUrls.push(data.url); 
        } else {
            throw new Error(data.error || "未知上传错误");
        }
    }
    return uploadedUrls;
}

function trySubmitTransaction() {
    const amountStr = document.getElementById('tx-amount').value.trim();
    const handler = document.getElementById('tx-handler').value.trim();
    const amountRegex = /^[+-]\d+(\.\d{1,2})?$/;
    
    if (!amountRegex.test(amountStr)) {
        return alert('金额格式错误！必须以 + 或 - 开头，例如 +100 或 -50.50');
    }
    if (!handler) return alert('请填写经手人姓名！');

    openModal('confirm-tx-modal');
}

async function executeTransaction() {
    closeModal('confirm-tx-modal');
    
    const amountStr = document.getElementById('tx-amount').value.trim();
    const handler = document.getElementById('tx-handler').value.trim();
    const notes = document.getElementById('tx-notes').value.trim();
    const fileInput = document.getElementById('tx-images-file');

    const btn = document.getElementById('btn-submit-tx');
    const originalBtnText = btn.innerText;
    
    btn.disabled = true;

    try {
        let finalImageUrls = [];
        
        if (fileInput.files.length > 0) {
            btn.innerText = "🚀 正在上传凭证...";
            finalImageUrls = await uploadFilesToCloud(fileInput.files);
        }

        btn.innerText = "正在同步账本...";

        const amount = parseFloat(amountStr);
        const newBalance = state.balance + amount;
        const now = new Date().toLocaleString('zh-CN');

        const currentRole = localStorage.getItem('club_user_role');
        const operatorName = (currentRole === 'master') ? '最高管理员 (Master)' : state.currentCashier;

        const tx = {
            id: Date.now(),
            time: now,
            amountStr: amountStr,
            balanceAfter: newBalance,
            handler: handler,
            cashier: operatorName,
            notes: notes,
            imagesData: finalImageUrls
        };

        state.balance = newBalance;
        state.lastUpdated = now;
        state.transactions.push(tx);
        
        const success = await saveData();
        
        if (success) {
            closeModal('add-transaction-modal');
            document.getElementById('tx-amount').value = '';
            document.getElementById('tx-handler').value = '';
            document.getElementById('tx-notes').value = '';
            fileInput.value = '';
            
            setTimeout(() => alert('✅ 账目与凭证已成功同步至云端！'), 100);
        }

    } catch (error) {
        alert("处理失败，请检查网络或配置：\n" + error.message);
    } finally {
        btn.innerText = originalBtnText;
        btn.disabled = false;
    }
}

/* ================= 最高管理员功能 ================= */
async function deleteTransaction(id) {
    const confirmDelete = window.confirm(
        "【最高权限操作】\n\n确定要永久删除这条记录吗？\n删除后，系统会自动重新校准后续所有账目的结余。\n\n此操作不可恢复！"
    );
    
    if (!confirmDelete) return;

    state.transactions = state.transactions.filter(tx => tx.id !== id);
    
    state.transactions.sort((a, b) => a.id - b.id);
    let runningBalance = 0;
    
    state.transactions.forEach(tx => {
        runningBalance += parseFloat(tx.amountStr);
        tx.balanceAfter = runningBalance;
    });
    
    state.balance = runningBalance;
    state.lastUpdated = new Date().toLocaleString('zh-CN') + " (管理员校准)";
    
    const success = await saveData();
    if (success) {
        renderLedger(); 
        alert("删除成功！账本已同步更新到云端。");
    }
}

/* ================= 渲染与交互 ================= */
function viewImage(urlStr) {
    document.getElementById('viewer-img').src = urlStr;
    openModal('image-viewer-modal');
}

function renderLedger() {
    const tbody = document.getElementById('ledger-tbody');
    tbody.innerHTML = '';
    
    const isMaster = localStorage.getItem('club_user_role') === 'master';
    const thAction = document.getElementById('th-admin-action');
    
    if (isMaster) {
        thAction.classList.remove('hidden');
    } else {
        thAction.classList.add('hidden');
    }
    
    const halfYearAgo = Date.now() - (180 * 24 * 60 * 60 * 1000);
    const validTxs = state.transactions
        .filter(tx => tx.id >= halfYearAgo)
        .sort((a, b) => b.id - a.id);

    if (validTxs.length === 0) {
        const colSpan = isMaster ? 8 : 7;
        tbody.innerHTML = `<tr><td colspan="${colSpan}" class="p-8 text-center text-slate-400">近半年无动账记录</td></tr>`;
        return;
    }

    validTxs.forEach(tx => {
        const tr = document.createElement('tr');
        tr.className = "hover:bg-slate-50 transition-colors group";
        
        const isIncome = tx.amountStr.startsWith('+');
        const amountColor = isIncome ? 'text-teal-600' : 'text-rose-500';
        
        let imgHtml = '-';
        if (tx.imagesData && tx.imagesData.length > 0) {
            imgHtml = tx.imagesData.map((data, idx) => 
                `<button onclick="viewImage('${data}')" class="inline-flex items-center gap-1 bg-indigo-50 text-indigo-600 hover:bg-indigo-100 px-2 py-1 rounded text-xs font-medium mr-1 mb-1 transition-colors">
                    图 ${idx+1}
                </button>`
            ).join('');
        }

        const isMasterOp = tx.cashier === '最高管理员 (Master)';
        const cashierBadgeClass = isMasterOp 
            ? 'bg-rose-100 text-rose-700 font-bold' 
            : 'bg-slate-100 text-slate-600 font-medium';

        let rowHtml = `
            <td class="p-4 text-slate-500">${tx.time}</td>
            <td class="p-4 ${amountColor} font-bold text-lg">${tx.amountStr}</td>
            <td class="p-4 font-mono text-slate-800 font-medium">¥ ${tx.balanceAfter.toLocaleString('zh-CN', {minimumFractionDigits: 2})}</td>
            <td class="p-4 text-slate-700">${tx.handler}</td>
            <td class="p-4 text-slate-700">
                <span class="${cashierBadgeClass} px-2 py-1 rounded text-xs">${tx.cashier}</span>
            </td>
            <td class="p-4 text-slate-600 whitespace-normal min-w-[200px] leading-relaxed">${tx.notes}</td>
            <td class="p-4 text-right">${imgHtml}</td>
        `;

        if (isMaster) {
            rowHtml += `
                <td class="p-4 text-center">
                    <button onclick="deleteTransaction(${tx.id})" class="text-rose-400 hover:text-rose-600 hover:bg-rose-50 px-3 py-1.5 rounded-lg transition-all text-sm font-bold border border-transparent hover:border-rose-200">
                        撤销/删除
                    </button>
                </td>
            `;
        }

        tr.innerHTML = rowHtml;
        tbody.appendChild(tr);
    });
}

// 启动系统
initSystem();