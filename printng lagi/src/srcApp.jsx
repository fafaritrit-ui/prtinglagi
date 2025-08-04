import React, { useState, useEffect, createContext, useContext, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged, signOut } from 'firebase/auth';
import { getFirestore, doc, collection, onSnapshot, addDoc, updateDoc, deleteDoc, query, where, setDoc, getDocs } from 'firebase/firestore';


// Variabel global untuk konfigurasi Firebase (disediakan oleh lingkungan)
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';


// Konteks untuk mengelola status pengguna dan aplikasi secara global
const AppContext = createContext();


// Komponen Modal yang dapat digunakan kembali untuk konfirmasi
const Modal = ({ show, title, message, onConfirm, onCancel }) => {
    if (!show) return null;

    return (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-2xl p-6 max-w-sm w-full">
                <h3 className="text-xl font-bold text-gray-800 mb-4">{title}</h3>
                <p className="text-gray-600 mb-6">{message}</p>
                <div className="flex justify-end space-x-3">
                    <button
                        onClick={onCancel}
                        className="px-4 py-2 bg-gray-200 text-gray-800 font-semibold rounded-lg hover:bg-gray-300 transition-colors"
                    >
                        Batal
                    </button>
                    <button
                        onClick={onConfirm}
                        className="px-4 py-2 bg-red-500 text-white font-semibold rounded-lg hover:bg-red-600 transition-colors"
                    >
                        Konfirmasi
                    </button>
                </div>
            </div>
        </div>
    );
};


const AppProvider = ({ children }) => {
    const [db, setDb] = useState(null);
    const [auth, setAuth] = useState(null);
    const [userId, setUserId] = useState(null);
    const [userRole, setUserRole] = useState(null);
    const [isAuthReady, setIsAuthReady] = useState(false);
    const [orders, setOrders] = useState([]);
    const [products, setProducts] = useState([]);
    const [expenses, setExpenses] = useState([]);
    const [users, setUsers] = useState([]);
    const [storeSettings, setStoreSettings] = useState({});
    const [currentPage, setCurrentPage] = useState('orders');
    const hasInitialized = useRef(false);

    useEffect(() => {
        // Hanya inisialisasi Firebase sekali
        if (Object.keys(firebaseConfig).length > 0 && !hasInitialized.current) {
            hasInitialized.current = true;
            const app = initializeApp(firebaseConfig);
            const firestore = getFirestore(app);
            const firebaseAuth = getAuth(app);
            setDb(firestore);
            setAuth(firebaseAuth);

            const signIn = async () => {
                try {
                    if (initialAuthToken) {
                        await signInWithCustomToken(firebaseAuth, initialAuthToken);
                    } else {
                        await signInAnonymously(firebaseAuth);
                    }
                } catch (error) {
                    console.error("Firebase Auth error:", error);
                }
            };
            
            const unsubscribe = onAuthStateChanged(firebaseAuth, (user) => {
                if (user) {
                    setUserId(user.uid);
                } else {
                    setUserId(null);
                }
                setIsAuthReady(true);
            });
            
            signIn();

            return () => unsubscribe();
        }
    }, []);

    useEffect(() => {
        if (!db || !isAuthReady) return;

        const setupListeners = async () => {
            // Pengaturan listener untuk pengguna
            const usersRef = collection(db, `artifacts/${appId}/public/data/users`);
            try {
                const querySnapshot = await getDocs(usersRef);
                if (querySnapshot.empty) {
                    console.log("No users found. Creating a default owner account.");
                    await addDoc(usersRef, {
                        username: 'owner',
                        password: '123',
                        role: 'owner',
                        createdAt: new Date().toISOString(),
                        userId: null,
                    });
                }
            } catch (error) {
                console.error("Error checking or creating default user:", error);
            }
            const unsubscribeUsers = onSnapshot(usersRef, (snapshot) => {
                const allUsers = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                setUsers(allUsers);
                const currentUserData = allUsers.find(u => u.userId === userId);
                setUserRole(currentUserData ? currentUserData.role : null);
            });

            // Pengaturan listener untuk data lain
            const ordersRef = collection(db, `artifacts/${appId}/public/data/orders`);
            const productsRef = collection(db, `artifacts/${appId}/public/data/products`);
            const expensesRef = collection(db, `artifacts/${appId}/public/data/expenses`);
            const storeSettingsRef = doc(db, `artifacts/${appId}/public/data/storeSettings`, 'main');
            
            const unsubscribeOrders = onSnapshot(ordersRef, (snapshot) => setOrders(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))));
            const unsubscribeProducts = onSnapshot(productsRef, (snapshot) => setProducts(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))));
            const unsubscribeExpenses = onSnapshot(expensesRef, (snapshot) => setExpenses(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))));
            
            // Pengaturan listener untuk pengaturan toko
            const unsubscribeStoreSettings = onSnapshot(storeSettingsRef, (doc) => {
                if (doc.exists()) {
                    setStoreSettings(doc.data());
                } else {
                    // Buat dokumen pengaturan default jika tidak ada
                    const defaultSettings = {
                        storeName: 'Toko Printing Anda',
                        address: 'Jl. Contoh No. 123',
                        phone: '081234567890',
                        receiptNotes: 'Terima kasih atas kunjungan Anda!',
                        logoUrl: 'https://placehold.co/200x100/000000/FFFFFF?text=Logo'
                    };
                    setDoc(storeSettingsRef, defaultSettings).catch(err => console.error("Error creating default store settings:", err));
                    setStoreSettings(defaultSettings);
                }
            });

            return () => {
                unsubscribeOrders();
                unsubscribeProducts();
                unsubscribeExpenses();
                unsubscribeUsers();
                unsubscribeStoreSettings();
            };
        };

        setupListeners();
    }, [db, isAuthReady, userId]);

    const handleLogout = async () => {
        if (!auth || !db || !userId) return;
        try {
            const currentUserDoc = users.find(u => u.userId === userId);
            if (currentUserDoc) {
                const userDocRef = doc(db, `artifacts/${appId}/public/data/users`, currentUserDoc.id);
                await updateDoc(userDocRef, { userId: null });
            }
            await signOut(auth);
            setUserRole(null);
            setCurrentPage('orders');
        } catch (error) {
            console.error("Error signing out:", error);
        }
    };

    const value = {
        db, auth, userId, userRole, isAuthReady,
        orders, products, expenses, users, storeSettings,
        currentPage, setCurrentPage, appId,
        handleLogout,
    };

    return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};


// Komponen App utama
export default function App() {
    return (
        <AppProvider>
            <div className="min-h-screen bg-gray-100 p-4 font-sans">
                <AppContent />
            </div>
        </AppProvider>
    );
}

const AppContent = () => {
    const { isAuthReady, userRole } = useContext(AppContext);

    if (!isAuthReady) {
        return (
            <div className="flex items-center justify-center h-screen text-xl font-semibold text-gray-700">
                Memuat aplikasi...
            </div>
        );
    }

    if (!userRole) {
        return <Login />;
    }

    return (
        <div className="container mx-auto">
            <h1 className="text-4xl font-bold text-center text-gray-800 my-6">Aplikasi Printing</h1>
            <Navbar />
            <div className="mt-8">
                <MainContent />
            </div>
        </div>
    );
};


const MainContent = () => {
    const { currentPage } = useContext(AppContext);
    
    switch (currentPage) {
        case 'orders': return <OrdersPage />;
        case 'payments': return <PaymentsPage />;
        case 'expenses': return <ExpensesPage />;
        case 'reports': return <ReportsPage />;
        case 'account-management': return <AccountManagementPage />;
        case 'product-management': return <ProductManagementPage />;
        case 'store-management': return <StoreManagementPage />;
        default: return <OrdersPage />;
    }
};


const Navbar = () => {
    const { userRole, currentPage, setCurrentPage, handleLogout } = useContext(AppContext);
    
    const menuItems = [
        { name: 'Pesanan', page: 'orders', roles: ['kasir', 'desainer', 'superviser', 'owner'] },
        { name: 'Pembayaran', page: 'payments', roles: ['kasir', 'owner'] },
        { name: 'Pengeluaran', page: 'expenses', roles: ['kasir', 'superviser', 'owner'] },
        { name: 'Laporan', page: 'reports', roles: ['superviser', 'owner'] },
        { name: 'Manajemen Akun', page: 'account-management', roles: ['owner'] },
        { name: 'Manajemen Produk', page: 'product-management', roles: ['desainer', 'superviser', 'owner'] },
        { name: 'Manajemen Toko', page: 'store-management', roles: ['owner'] },
    ];
    
    return (
        <nav className="bg-white shadow-lg rounded-lg p-4">
            <ul className="flex flex-wrap justify-center items-center gap-4">
                {menuItems.map((item) => (
                    item.roles.includes(userRole) && (
                        <li key={item.page}>
                            <button
                                onClick={() => setCurrentPage(item.page)}
                                className={`px-4 py-2 rounded-lg font-semibold transition-colors ${currentPage === item.page ? 'bg-blue-600 text-white' : 'bg-blue-500 text-white hover:bg-blue-600'}`}
                            >
                                {item.name}
                            </button>
                        </li>
                    )
                ))}
                <li>
                    <button
                        onClick={handleLogout}
                        className="px-4 py-2 rounded-lg bg-red-500 text-white font-semibold hover:bg-red-600 transition-colors"
                    >
                        Logout
                    </button>
                </li>
            </ul>
        </nav>
    );
};


const Login = () => {
    const { db, appId, userId, isAuthReady, users } = useContext(AppContext);
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');

    const handleLogin = async (e) => {
        e.preventDefault();
        if (!db || !isAuthReady) {
            setError('Aplikasi belum siap. Silakan coba lagi.');
            return;
        }

        const user = users.find(u => u.username === username && u.password === password);
        if (user) {
            try {
                const userDocRef = doc(db, `artifacts/${appId}/public/data/users`, user.id);
                await setDoc(userDocRef, { ...user, userId }, { merge: true });
            } catch (err) {
                console.error("Failed to update user document on login:", err);
                setError("Login gagal. Silakan coba lagi.");
            }
        } else {
            setError('Username atau password salah.');
        }
    };
    
    return (
        <div className="flex items-center justify-center h-screen bg-gray-100">
            <div className="bg-white p-8 rounded-xl shadow-lg w-full max-w-sm">
                <h2 className="text-3xl font-bold text-center text-gray-800 mb-6">Login</h2>
                <form onSubmit={handleLogin}>
                    <div className="mb-4">
                        <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="username">Username</label>
                        <input
                            type="text"
                            id="username"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            className="shadow appearance-none border rounded-lg w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                        />
                    </div>
                    <div className="mb-6">
                        <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="password">Password</label>
                        <input
                            type="password"
                            id="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className="shadow appearance-none border rounded-lg w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                        />
                    </div>
                    {error && <p className="text-red-500 text-xs italic mb-4">{error}</p>}
                    <div className="flex items-center justify-between">
                        <button
                            type="submit"
                            className="w-full bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-lg focus:outline-none focus:shadow-outline transition-colors"
                        >
                            Masuk
                        </button>
                    </div>
                    <div className="mt-4 text-center text-sm text-gray-500">
                        <p>Credentials: </p>
                        <p>Username: owner, Password: 123</p>
                    </div>
                </form>
            </div>
        </div>
    );
};


const OrdersPage = () => {
    const { db, appId, orders, products, userRole, storeSettings } = useContext(AppContext);
    const [isEditing, setIsEditing] = useState(false);
    const [currentOrder, setCurrentOrder] = useState({
        customerName: '',
        items: [],
        totalCost: 0,
    });
    const [message, setMessage] = useState('');
    const [modal, setModal] = useState({ show: false, action: null, itemId: null });

    const generateOrderId = () => {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hour = String(now.getHours()).padStart(2, '0');
        const minute = String(now.getMinutes()).padStart(2, '0');
        const second = String(now.getSeconds()).padStart(2, '0');
        const uniqueCode = Math.floor(100000 + Math.random() * 900000);
        return `P-${year}${month}${day}-${hour}${minute}${second}-${uniqueCode}`;
    };

    const handleAddOrderItem = () => {
        setCurrentOrder(prev => ({
            ...prev,
            items: [...prev.items, { productId: '', quantity: 1, width: 0, height: 0 }],
        }));
    };

    // FUNGSI DIPERBARUI: Logika pembaruan item yang lebih andal
    const handleUpdateOrderItem = (index, key, value) => {
        const updatedItems = currentOrder.items.map((item, i) => {
            if (i === index) {
                return { ...item, [key]: value };
            }
            return item;
        });
        setCurrentOrder(prev => ({ ...prev, items: updatedItems }));
    };

    const handleRemoveOrderItem = (index) => {
        const updatedItems = currentOrder.items.filter((_, i) => i !== index);
        setCurrentOrder(prev => ({ ...prev, items: updatedItems }));
    };

    const calculateItemPrice = (item) => {
        const product = products.find(p => p.id === item.productId);
        if (product) {
            if (product.calculationMethod === 'dimensi') return (item.width * item.height * product.price);
            if (product.calculationMethod === 'paket' || product.calculationMethod === 'satuan') return (item.quantity * product.price);
        }
        return 0;
    };

    useEffect(() => {
        const total = currentOrder.items.reduce((acc, item) => acc + calculateItemPrice(item), 0);
        setCurrentOrder(prev => ({ ...prev, totalCost: total }));
    }, [currentOrder.items, products]);

    const handleSubmitOrder = async (e) => {
        e.preventDefault();
        if (!db) return;
        try {
            if (isEditing) {
                const orderDocRef = doc(db, `artifacts/${appId}/public/data/orders`, currentOrder.id);
                await updateDoc(orderDocRef, { ...currentOrder, items: JSON.stringify(currentOrder.items), updatedAt: new Date().toISOString() });
                setMessage('Pesanan berhasil diperbarui!');
            } else {
                const orderId = generateOrderId();
                await setDoc(doc(db, `artifacts/${appId}/public/data/orders`, orderId), {
                    ...currentOrder, id: orderId, items: JSON.stringify(currentOrder.items),
                    paymentStatus: 'Belum Lunas', paymentMethod: '', paidAmount: 0,
                    createdAt: new Date().toISOString(),
                });
                setMessage('Pesanan berhasil ditambahkan!');
            }
            setCurrentOrder({ customerName: '', items: [], totalCost: 0 });
            setIsEditing(false);
            setTimeout(() => setMessage(''), 3000);
        } catch (error) {
            console.error("Error saving order:", error);
            setMessage('Gagal menyimpan pesanan.');
        }
    };

    const handleEditOrder = (order) => {
        const { paymentStatus, paymentMethod, paidAmount, ...rest } = order;
        setCurrentOrder({ ...rest, items: JSON.parse(order.items) });
        setIsEditing(true);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const handleDeleteOrder = async (id) => {
        if (!db) return;
        try {
            await deleteDoc(doc(db, `artifacts/${appId}/public/data/orders`, id));
            setMessage('Pesanan berhasil dihapus.');
            setTimeout(() => setMessage(''), 3000);
        } catch (error) {
            console.error("Error deleting order:", error);
            setMessage('Gagal menghapus pesanan.');
        }
        setModal({ show: false, action: null, itemId: null });
    };
    
    const handlePrintReceipt = (order) => {
        const parsedItems = JSON.parse(order.items);
        const change = order.paidAmount > order.totalCost ? order.paidAmount - order.totalCost : 0;
        const remaining = order.totalCost - order.paidAmount > 0 ? order.totalCost - order.paidAmount : 0;

        let receiptContent = `
            <div style="font-family: monospace; font-size: 10px; width: 80mm; text-align: left; padding: 5mm;">
                ${storeSettings.logoUrl ? `<img src="${storeSettings.logoUrl}" alt="Logo" style="max-width: 100px; margin: 0 auto 10px auto; display: block;"/>` : ''}
                <h2 style="text-align: center; margin: 0; font-size: 14px;">${storeSettings.storeName || 'Toko Printing'}</h2>
                <p style="text-align: center; margin: 2px 0;">${storeSettings.address || ''}</p>
                <p style="text-align: center; margin: 2px 0 10px 0;">${storeSettings.phone || ''}</p>
                <hr style="border-top: 1px dashed black;">
                <p><strong>ID Pesanan:</strong> ${order.id}</p>
                <p><strong>Nama Pemesan:</strong> ${order.customerName}</p>
                <p><strong>Tanggal:</strong> ${new Date(order.createdAt).toLocaleString('id-ID')}</p>
                <hr style="border-top: 1px dashed black;">
                <p><strong>Detail Pesanan:</strong></p>
                <table style="width: 100%; font-size: 10px;">
                    ${parsedItems.map(item => {
                        const product = products.find(p => p.id === item.productId);
                        const itemPrice = calculateItemPrice(item);
                        return `<tr>
                                    <td style="vertical-align: top;">${product ? product.name : 'N/A'}</td>
                                    <td style="text-align: right; vertical-align: top;">${item.quantity}x</td>
                                    <td style="text-align: right; vertical-align: top;">Rp ${itemPrice.toLocaleString('id-ID')}</td>
                                </tr>`;
                    }).join('')}
                </table>
                <hr style="border-top: 1px dashed black;">
                <p><strong>Total Biaya:</strong> <span style="float: right;">Rp ${order.totalCost.toLocaleString('id-ID')}</span></p>
                <p><strong>Jumlah Dibayar:</strong> <span style="float: right;">Rp ${order.paidAmount.toLocaleString('id-ID')}</span></p>
                <p><strong>Status:</strong> <span style="float: right;">${order.paymentStatus}</span></p>
                <p><strong>Metode:</strong> <span style="float: right;">${order.paymentMethod || 'N/A'}</span></p>
                <hr style="border-top: 1px dashed black;">
                ${change > 0 ? `<p><strong>Kembalian:</strong> <span style="float: right;">Rp ${change.toLocaleString('id-ID')}</span></p>` : ''}
                ${remaining > 0 ? `<p><strong>Sisa Hutang:</strong> <span style="float: right;">Rp ${remaining.toLocaleString('id-ID')}</span></p>` : ''}
                <hr style="border-top: 1px dashed black;">
                <p style="text-align: center; margin-top: 10px;">${storeSettings.receiptNotes || 'Terima kasih!'}</p>
            </div>
        `;
        const printWindow = window.open('', '', 'width=300,height=600');
        printWindow.document.open();
        printWindow.document.write(receiptContent);
        printWindow.document.close();
        printWindow.print();
    };

    return (
        <div className="bg-white rounded-xl shadow-lg p-6">
            <h2 className="text-2xl font-bold mb-4">{isEditing ? 'Edit Pesanan' : 'Tambah Pesanan'}</h2>
            {message && <div className="bg-green-100 text-green-700 p-3 rounded-lg mb-4">{message}</div>}
            <form onSubmit={handleSubmitOrder} className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                    <label className="block text-gray-700">Nama Pemesan</label>
                    <input type="text" value={currentOrder.customerName} onChange={(e) => setCurrentOrder({ ...currentOrder, customerName: e.target.value })} className="w-full p-2 border border-gray-300 rounded-lg" required />
                </div>
                <div className="md:col-span-2">
                    <h3 className="text-xl font-semibold mt-4 mb-2">Item Pesanan</h3>
                    {currentOrder.items.map((item, index) => {
                        const itemPrice = calculateItemPrice(item);
                        return (
                            <div key={index} className="flex flex-wrap items-center space-x-2 mb-2 p-2 bg-gray-50 rounded-lg border">
                                {/* UI DIPERBARUI: Menambahkan pesan jika produk kosong */}
                                <select value={item.productId} onChange={(e) => handleUpdateOrderItem(index, 'productId', e.target.value)} className="flex-grow p-2 border rounded-lg mb-2 md:mb-0" required>
                                    <option value="">Pilih Produk</option>
                                    {products.length > 0 ? (
                                        products.map(product => (<option key={product.id} value={product.id}>{product.name} ({product.calculationMethod})</option>))
                                    ) : (
                                        <option value="" disabled>Belum ada produk. Tambahkan di Manajemen Produk.</option>
                                    )}
                                </select>
                                {products.find(p => p.id === item.productId)?.calculationMethod === 'dimensi' ? (
                                    <>
                                        <input type="number" step="0.01" placeholder="Lebar (cm)" value={item.width} onChange={(e) => handleUpdateOrderItem(index, 'width', parseFloat(e.target.value) || 0)} className="w-24 p-2 border rounded-lg mb-2 md:mb-0" required />
                                        <input type="number" step="0.01" placeholder="Tinggi (cm)" value={item.height} onChange={(e) => handleUpdateOrderItem(index, 'height', parseFloat(e.target.value) || 0)} className="w-24 p-2 border rounded-lg mb-2 md:mb-0" required />
                                    </>
                                ) : (
                                    <input type="number" placeholder="Jumlah" value={item.quantity} onChange={(e) => handleUpdateOrderItem(index, 'quantity', parseInt(e.target.value, 10) || 1)} className="w-24 p-2 border rounded-lg mb-2 md:mb-0" required />
                                )}
                                <span className="text-sm font-semibold text-gray-700">Rp {itemPrice.toLocaleString('id-ID')}</span>
                                <button type="button" onClick={() => handleRemoveOrderItem(index)} className="bg-red-500 text-white p-2 rounded-lg hover:bg-red-600 transition-colors">Hapus</button>
                            </div>
                        );
                    })}
                    <button type="button" onClick={handleAddOrderItem} className="mt-2 w-full bg-green-500 text-white p-2 rounded-lg hover:bg-green-600 transition-colors">Tambah Item</button>
                </div>
                <div className="md:col-span-2 mt-4"><p className="text-xl font-bold text-right">Total Biaya: Rp {currentOrder.totalCost.toLocaleString('id-ID')}</p></div>
                <div className="md:col-span-2"><button type="submit" className="w-full bg-blue-500 text-white font-bold py-2 rounded-lg hover:bg-blue-600 transition-colors">{isEditing ? 'Simpan Perubahan' : 'Simpan Pesanan'}</button></div>
            </form>

            <div className="mt-8">
                <h2 className="text-2xl font-bold mb-4">Daftar Pesanan</h2>
                <div className="overflow-x-auto">
                    <table className="min-w-full bg-white rounded-lg shadow">
                        <thead><tr className="bg-gray-200 text-gray-600 uppercase text-sm leading-normal"><th className="py-3 px-6 text-left">ID Pesanan</th><th className="py-3 px-6 text-left">Nama Pemesan</th><th className="py-3 px-6 text-left">Total Biaya</th><th className="py-3 px-6 text-left">Status</th><th className="py-3 px-6 text-left">Aksi</th></tr></thead>
                        <tbody className="text-gray-600 text-sm font-light">
                            {orders.map(order => (
                                <tr key={order.id} className="border-b border-gray-200 hover:bg-gray-100">
                                    <td className="py-3 px-6 text-left whitespace-nowrap">{order.id}</td>
                                    <td className="py-3 px-6 text-left whitespace-nowrap">{order.customerName}</td>
                                    <td className="py-3 px-6 text-left">Rp {order.totalCost.toLocaleString('id-ID')}</td>
                                    <td className="py-3 px-6 text-left"><span className={`py-1 px-3 text-xs font-bold rounded-full ${order.paymentStatus === 'Belum Lunas' ? 'bg-red-200 text-red-800' : 'bg-green-200 text-green-800'}`}>{order.paymentStatus}</span></td>
                                    <td className="py-3 px-6 text-left">
                                        <button onClick={() => handleEditOrder(order)} className="text-blue-500 hover:text-blue-700 mr-2">Edit</button>
                                        <button onClick={() => handlePrintReceipt(order)} className="text-green-500 hover:text-green-700 mr-2">Cetak Struk</button>
                                        {(userRole === 'superviser' || userRole === 'owner') && (<button onClick={() => setModal({ show: true, action: () => handleDeleteOrder(order.id), itemId: order.id })} className="text-red-500 hover:text-red-700">Hapus</button>)}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
            <Modal show={modal.show} title="Konfirmasi Hapus" message="Apakah Anda yakin ingin menghapus pesanan ini?" onConfirm={modal.action} onCancel={() => setModal({ show: false, action: null, itemId: null })} />
        </div>
    );
};


const PaymentsPage = () => {
    const { db, appId, orders, products } = useContext(AppContext);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [selectedOrder, setSelectedOrder] = useState(null);
    const [paidAmount, setPaidAmount] = useState(0);
    const [message, setMessage] = useState('');

    const handleSearch = (e) => {
        e.preventDefault();
        const queryLower = searchQuery.toLowerCase();
        const results = orders.filter(o => o.id.toLowerCase().includes(queryLower) || o.customerName.toLowerCase().includes(queryLower));
        setSearchResults(results);
        setSelectedOrder(null);
        setMessage(results.length === 0 ? 'Tidak ada pesanan yang ditemukan.' : '');
    };

    const handleSelectOrder = (order) => {
        setSelectedOrder(order);
        setPaidAmount(order.paidAmount || 0);
    };

    const handleSettlePayment = async () => {
        if (!db || !selectedOrder) return;
        try {
            const orderDocRef = doc(db, `artifacts/${appId}/public/data/orders`, selectedOrder.id);
            const newPaidAmount = paidAmount;
            const newPaymentStatus = newPaidAmount >= selectedOrder.totalCost ? 'Lunas' : 'Belum Lunas';
            await updateDoc(orderDocRef, {
                paymentStatus: newPaymentStatus,
                paidAmount: newPaidAmount,
                updatedAt: new Date().toISOString(),
                paymentMethod: 'Cash',
            });
            setMessage('Pembayaran berhasil diperbarui!');
            setSelectedOrder(null);
            setSearchResults([]);
            setSearchQuery('');
            setTimeout(() => setMessage(''), 3000);
        } catch (error) {
            console.error("Error updating payment:", error);
            setMessage('Gagal memperbarui status pembayaran.');
        }
    };

    const change = paidAmount - (selectedOrder?.totalCost || 0);
    
    return (
        <div className="bg-white rounded-xl shadow-lg p-6">
            <h2 className="text-2xl font-bold mb-4">Pembayaran Pesanan</h2>
            {message && <div className={`p-3 rounded-lg mb-4 ${message.includes('Gagal') ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>{message}</div>}
            <form onSubmit={handleSearch} className="flex space-x-2 mb-6">
                <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Cari ID Pesanan atau Nama Pelanggan" className="flex-grow p-2 border border-gray-300 rounded-lg" required />
                <button type="submit" className="bg-blue-500 text-white font-bold py-2 px-4 rounded-lg hover:bg-blue-600 transition-colors">Cari</button>
            </form>
            {searchResults.length > 0 && !selectedOrder && (
                <div className="mb-4"><h3 className="text-lg font-semibold mb-2">Hasil Pencarian:</h3><div className="max-h-60 overflow-y-auto border border-gray-200 rounded-lg">{searchResults.map(order => (<button key={order.id} onClick={() => handleSelectOrder(order)} className="w-full text-left p-3 hover:bg-gray-100 border-b last:border-b-0"><p className="font-bold">ID: {order.id}</p><p>Nama: {order.customerName}</p></button>))}</div></div>
            )}
            {selectedOrder && (
                <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
                    <h3 className="text-xl font-bold mb-2">Detail Pesanan: {selectedOrder.id}</h3>
                    <p><strong>Nama Pemesan:</strong> {selectedOrder.customerName}</p>
                    <p><strong>Total Biaya:</strong> Rp {selectedOrder.totalCost.toLocaleString('id-ID')}</p>
                    <div className="mt-4"><h4 className="font-semibold">Item:</h4><ul className="list-disc list-inside">{JSON.parse(selectedOrder.items).map((item, index) => (<li key={index}>{products.find(p => p.id === item.productId)?.name || 'N/A'} - Qty: {item.quantity}</li>))}</ul></div>
                    <div className="mt-4"><label className="block text-gray-700">Jumlah Dibayarkan (IDR)</label><input type="number" value={paidAmount} onChange={(e) => setPaidAmount(parseFloat(e.target.value) || 0)} className="w-full p-2 border border-gray-300 rounded-lg" /></div>
                    <div className="mt-4 p-4 rounded-xl text-center font-bold">{change >= 0 ? (<div className="bg-green-100 text-green-700"><p className="text-lg">Kembalian: Rp {change.toLocaleString('id-ID')}</p></div>) : (<div className="bg-red-100 text-red-700"><p className="text-lg">Sisa Hutang: Rp {Math.abs(change).toLocaleString('id-ID')}</p></div>)}</div>
                    <div className="mt-6 flex justify-end space-x-3"><button onClick={() => setSelectedOrder(null)} className="bg-gray-500 text-white font-bold py-2 px-4 rounded-lg hover:bg-gray-600">Batal</button><button onClick={handleSettlePayment} className="bg-green-500 text-white font-bold py-2 px-4 rounded-lg hover:bg-green-600">Simpan Pembayaran</button></div>
                </div>
            )}
        </div>
    );
};


const ExpensesPage = () => {
    const { db, appId, expenses, userRole } = useContext(AppContext);
    const [description, setDescription] = useState('');
    const [cost, setCost] = useState(0);
    const [message, setMessage] = useState('');
    const [modal, setModal] = useState({ show: false, action: null, itemId: null });

    const handleSubmitExpense = async (e) => {
        e.preventDefault();
        if (!db) return;
        try {
            await addDoc(collection(db, `artifacts/${appId}/public/data/expenses`), { description, cost, createdAt: new Date().toISOString() });
            setMessage('Pengeluaran berhasil ditambahkan!');
            setDescription(''); setCost(0);
            setTimeout(() => setMessage(''), 3000);
        } catch (error) {
            console.error("Error adding expense:", error);
            setMessage('Gagal menyimpan pengeluaran.');
        }
    };

    const handleDeleteExpense = async (id) => {
        if (!db) return;
        try {
            await deleteDoc(doc(db, `artifacts/${appId}/public/data/expenses`, id));
            setMessage('Pengeluaran berhasil dihapus.');
            setTimeout(() => setMessage(''), 3000);
        } catch (error) {
            console.error("Error deleting expense:", error);
            setMessage('Gagal menghapus pengeluaran.');
        }
        setModal({ show: false, action: null, itemId: null });
    };

    return (
        <div className="bg-white rounded-xl shadow-lg p-6">
            <h2 className="text-2xl font-bold mb-4">Transaksi Pengeluaran</h2>
            {message && <div className="bg-green-100 text-green-700 p-3 rounded-lg mb-4">{message}</div>}
            <form onSubmit={handleSubmitExpense} className="space-y-4">
                <div><label className="block text-gray-700">Deskripsi</label><input type="text" value={description} onChange={(e) => setDescription(e.target.value)} className="w-full p-2 border border-gray-300 rounded-lg" required /></div>
                <div><label className="block text-gray-700">Biaya</label><input type="number" value={cost} onChange={(e) => setCost(parseFloat(e.target.value) || 0)} className="w-full p-2 border border-gray-300 rounded-lg" required /></div>
                <button type="submit" className="w-full bg-blue-500 text-white font-bold py-2 rounded-lg hover:bg-blue-600">Tambah Pengeluaran</button>
            </form>
            <div className="mt-8">
                <h2 className="text-2xl font-bold mb-4">Daftar Pengeluaran</h2>
                <div className="overflow-x-auto">
                    <table className="min-w-full bg-white rounded-lg shadow">
                        <thead><tr className="bg-gray-200 text-gray-600 uppercase text-sm leading-normal"><th className="py-3 px-6 text-left">Deskripsi</th><th className="py-3 px-6 text-left">Biaya</th><th className="py-3 px-6 text-left">Tanggal</th>{(userRole === 'superviser' || userRole === 'owner') && <th className="py-3 px-6 text-left">Aksi</th>}</tr></thead>
                        <tbody className="text-gray-600 text-sm font-light">
                            {expenses.map(expense => (
                                <tr key={expense.id} className="border-b border-gray-200 hover:bg-gray-100">
                                    <td className="py-3 px-6 text-left">{expense.description}</td>
                                    <td className="py-3 px-6 text-left">Rp {expense.cost.toLocaleString('id-ID')}</td>
                                    <td className="py-3 px-6 text-left">{new Date(expense.createdAt).toLocaleDateString()}</td>
                                    {(userRole === 'superviser' || userRole === 'owner') && (<td className="py-3 px-6 text-left"><button onClick={() => setModal({ show: true, action: () => handleDeleteExpense(expense.id), itemId: expense.id })} className="text-red-500 hover:text-red-700">Hapus</button></td>)}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
            <Modal show={modal.show} title="Konfirmasi Hapus" message="Apakah Anda yakin ingin menghapus pengeluaran ini?" onConfirm={modal.action} onCancel={() => setModal({ show: false, action: null, itemId: null })} />
        </div>
    );
};


const ReportsPage = () => {
    const { orders, expenses } = useContext(AppContext);
    const [reportType, setReportType] = useState('daily');
    const [filteredOrders, setFilteredOrders] = useState([]);
    const [filteredExpenses, setFilteredExpenses] = useState([]);

    useEffect(() => {
        const now = new Date();
        let start, end;
        if (reportType === 'daily') {
            start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
        } else if (reportType === 'monthly') {
            start = new Date(now.getFullYear(), now.getMonth(), 1);
            end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        } else { // yearly
            start = new Date(now.getFullYear(), 0, 1);
            end = new Date(now.getFullYear() + 1, 0, 1);
        }
        setFilteredOrders(orders.filter(o => new Date(o.createdAt) >= start && new Date(o.createdAt) < end));
        setFilteredExpenses(expenses.filter(e => new Date(e.createdAt) >= start && new Date(e.createdAt) < end));
    }, [orders, expenses, reportType]);

    const cashIn = filteredOrders.filter(o => o.paymentStatus === 'Lunas').reduce((acc, o) => acc + o.paidAmount, 0);
    const totalSales = filteredOrders.reduce((acc, o) => acc + o.totalCost, 0);
    const totalExpenses = filteredExpenses.reduce((acc, e) => acc + e.cost, 0);
    const profit = totalSales - totalExpenses;
    const cashFlow = cashIn - totalExpenses;

    const downloadReport = () => {
        const headers = ["Tipe", "Tanggal", "Deskripsi", "Jumlah"];
        let csvContent = "data:text/csv;charset=utf-8," + headers.join(",") + "\n";
        filteredOrders.forEach(o => csvContent += ["Penjualan", new Date(o.createdAt).toLocaleDateString(), `Pesanan ${o.customerName}`, o.totalCost].join(",") + "\n");
        filteredExpenses.forEach(e => csvContent += ["Pengeluaran", new Date(e.createdAt).toLocaleDateString(), e.description, -e.cost].join(",") + "\n");
        const link = document.createElement("a");
        link.setAttribute("href", encodeURI(csvContent));
        link.setAttribute("download", `laporan_${reportType}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    return (
        <div className="bg-white rounded-xl shadow-lg p-6">
            <h2 className="text-2xl font-bold mb-4">Laporan Keuangan</h2>
            <div className="flex space-x-4 mb-4">
                <button onClick={() => setReportType('daily')} className={`px-4 py-2 rounded-lg ${reportType === 'daily' ? 'bg-blue-500 text-white' : 'bg-gray-200'}`}>Harian</button>
                <button onClick={() => setReportType('monthly')} className={`px-4 py-2 rounded-lg ${reportType === 'monthly' ? 'bg-blue-500 text-white' : 'bg-gray-200'}`}>Bulanan</button>
                <button onClick={() => setReportType('yearly')} className={`px-4 py-2 rounded-lg ${reportType === 'yearly' ? 'bg-blue-500 text-white' : 'bg-gray-200'}`}>Tahunan</button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4 text-center">
                <div className="bg-blue-100 p-4 rounded-lg"><h3 className="text-xl font-semibold">Total Penjualan</h3><p className="text-2xl font-bold">Rp {totalSales.toLocaleString('id-ID')}</p></div>
                <div className="bg-red-100 p-4 rounded-lg"><h3 className="text-xl font-semibold">Total Pengeluaran</h3><p className="text-2xl font-bold">Rp {totalExpenses.toLocaleString('id-ID')}</p></div>
                <div className="bg-green-100 p-4 rounded-lg"><h3 className="text-xl font-semibold">Keuntungan (P&L)</h3><p className="text-2xl font-bold">Rp {profit.toLocaleString('id-ID')}</p></div>
                <div className="bg-purple-100 p-4 rounded-lg"><h3 className="text-xl font-semibold">Arus Kas Bersih</h3><p className="text-2xl font-bold">Rp {cashFlow.toLocaleString('id-ID')}</p></div>
            </div>
            <button onClick={downloadReport} className="mb-4 bg-green-500 text-white font-bold py-2 px-4 rounded-lg hover:bg-green-600">Unduh Laporan CSV</button>
            <h3 className="text-xl font-bold mt-6 mb-2">Detail Transaksi Penjualan</h3>
            <div className="overflow-x-auto"><table className="min-w-full bg-white rounded-lg shadow"><thead><tr className="bg-gray-200 text-gray-600 uppercase text-sm leading-normal"><th className="py-3 px-6 text-left">Tanggal</th><th className="py-3 px-6 text-left">Nama Pemesan</th><th className="py-3 px-6 text-left">Total Biaya</th><th className="py-3 px-6 text-left">Status</th></tr></thead><tbody className="text-gray-600 text-sm font-light">{filteredOrders.map(o => (<tr key={o.id} className="border-b border-gray-200 hover:bg-gray-100"><td className="py-3 px-6 text-left">{new Date(o.createdAt).toLocaleDateString()}</td><td className="py-3 px-6 text-left">{o.customerName}</td><td className="py-3 px-6 text-left">Rp {o.totalCost.toLocaleString('id-ID')}</td><td className="py-3 px-6 text-left">{o.paymentStatus}</td></tr>))}</tbody></table></div>
            <h3 className="text-xl font-bold mt-6 mb-2">Detail Transaksi Pengeluaran</h3>
            <div className="overflow-x-auto"><table className="min-w-full bg-white rounded-lg shadow"><thead><tr className="bg-gray-200 text-gray-600 uppercase text-sm leading-normal"><th className="py-3 px-6 text-left">Tanggal</th><th className="py-3 px-6 text-left">Deskripsi</th><th className="py-3 px-6 text-left">Biaya</th></tr></thead><tbody className="text-gray-600 text-sm font-light">{filteredExpenses.map(e => (<tr key={e.id} className="border-b border-gray-200 hover:bg-gray-100"><td className="py-3 px-6 text-left">{new Date(e.createdAt).toLocaleDateString()}</td><td className="py-3 px-6 text-left">{e.description}</td><td className="py-3 px-6 text-left">Rp {e.cost.toLocaleString('id-ID')}</td></tr>))}</tbody></table></div>
        </div>
    );
};


const AccountManagementPage = () => {
    const { db, appId, users, userId } = useContext(AppContext);
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [role, setRole] = useState('kasir');
    const [message, setMessage] = useState('');
    const [modal, setModal] = useState({ show: false, action: null, itemId: null });

    const handleAddUser = async (e) => {
        e.preventDefault();
        if (!db) return;
        try {
            await addDoc(collection(db, `artifacts/${appId}/public/data/users`), { username, password, role, createdAt: new Date().toISOString(), userId: null });
            setMessage('Akun berhasil ditambahkan!');
            setUsername(''); setPassword(''); setRole('kasir');
            setTimeout(() => setMessage(''), 3000);
        } catch (error) {
            console.error("Error adding user:", error);
            setMessage('Gagal menambahkan akun.');
        }
    };

    const handleDeleteUser = async (id) => {
        if (!db) return;
        try {
            await deleteDoc(doc(db, `artifacts/${appId}/public/data/users`, id));
            setMessage('Akun berhasil dihapus.');
            setTimeout(() => setMessage(''), 3000);
        } catch (error) {
            console.error("Error deleting user:", error);
            setMessage('Gagal menghapus akun.');
        }
        setModal({ show: false, action: null, itemId: null });
    };

    return (
        <div className="bg-white rounded-xl shadow-lg p-6">
            <h2 className="text-2xl font-bold mb-4">Manajemen Akun</h2>
            {message && <div className="bg-green-100 text-green-700 p-3 rounded-lg mb-4">{message}</div>}
            <form onSubmit={handleAddUser} className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
                <div><label className="block text-gray-700">Username</label><input type="text" value={username} onChange={(e) => setUsername(e.target.value)} className="w-full p-2 border border-gray-300 rounded-lg" required /></div>
                <div><label className="block text-gray-700">Password</label><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full p-2 border border-gray-300 rounded-lg" required /></div>
                <div><label className="block text-gray-700">Role</label><select value={role} onChange={(e) => setRole(e.target.value)} className="w-full p-2 border border-gray-300 rounded-lg"><option value="kasir">Kasir</option><option value="desainer">Desainer</option><option value="superviser">Superviser</option><option value="owner">Owner</option></select></div>
                <div className="md:col-span-3"><button type="submit" className="w-full bg-blue-500 text-white font-bold py-2 rounded-lg hover:bg-blue-600">Tambah Akun Baru</button></div>
            </form>
            <h3 className="text-xl font-bold mb-2">Daftar Akun</h3>
            <div className="overflow-x-auto">
                <table className="min-w-full bg-white rounded-lg shadow">
                    <thead><tr className="bg-gray-200 text-gray-600 uppercase text-sm leading-normal"><th className="py-3 px-6 text-left">Username</th><th className="py-3 px-6 text-left">Role</th><th className="py-3 px-6 text-left">User ID</th><th className="py-3 px-6 text-left">Aksi</th></tr></thead>
                    <tbody className="text-gray-600 text-sm font-light">
                        {users.map(user => (<tr key={user.id} className="border-b border-gray-200 hover:bg-gray-100"><td className="py-3 px-6 text-left">{user.username}</td><td className="py-3 px-6 text-left">{user.role}</td><td className="py-3 px-6 text-left">{user.userId || 'N/A'}</td><td className="py-3 px-6 text-left">{user.userId !== userId && (<button onClick={() => setModal({ show: true, action: () => handleDeleteUser(user.id), itemId: user.id })} className="text-red-500 hover:text-red-700">Hapus</button>)}</td></tr>))}
                    </tbody>
                </table>
            </div>
            <Modal show={modal.show} title="Konfirmasi Hapus" message="Apakah Anda yakin ingin menghapus akun ini?" onConfirm={modal.action} onCancel={() => setModal({ show: false, action: null, itemId: null })} />
        </div>
    );
};


const ProductManagementPage = () => {
    const { db, appId, products } = useContext(AppContext);
    const [isEditing, setIsEditing] = useState(false);
    const [currentProduct, setCurrentProduct] = useState({ id: '', name: '', price: 0, calculationMethod: 'satuan' });
    const [message, setMessage] = useState('');
    const [modal, setModal] = useState({ show: false, action: null, itemId: null });

    const handleAddOrUpdateProduct = async (e) => {
        e.preventDefault();
        if (!db) return;
        try {
            if (isEditing) {
                const { id, ...productData } = currentProduct;
                const productDocRef = doc(db, `artifacts/${appId}/public/data/products`, id);
                await updateDoc(productDocRef, { ...productData, updatedAt: new Date().toISOString() });
                setMessage('Produk berhasil diperbarui!');
            } else {
                const { id, ...newProductData } = currentProduct;
                await addDoc(collection(db, `artifacts/${appId}/public/data/products`), { ...newProductData, createdAt: new Date().toISOString() });
                setMessage('Produk berhasil ditambahkan!');
            }
            handleResetForm();
            setTimeout(() => setMessage(''), 3000);
        } catch (error) {
            console.error("Error saving product:", error);
            setMessage('Gagal menyimpan produk.');
        }
    };

    const handleEditProduct = (product) => {
        setCurrentProduct(product);
        setIsEditing(true);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const handleDeleteProduct = async (id) => {
        if (!db) return;
        try {
            await deleteDoc(doc(db, `artifacts/${appId}/public/data/products`, id));
            setMessage('Produk berhasil dihapus.');
            setTimeout(() => setMessage(''), 3000);
        } catch (error) {
            console.error("Error deleting product:", error);
            setMessage('Gagal menghapus produk.');
        }
        setModal({ show: false, action: null, itemId: null });
    };
    
    const handleResetForm = () => {
        setCurrentProduct({ id: '', name: '', price: 0, calculationMethod: 'satuan' });
        setIsEditing(false);
    };

    return (
        <div className="bg-white rounded-xl shadow-lg p-6">
            <h2 className="text-2xl font-bold mb-4">{isEditing ? 'Edit Produk' : 'Tambah Produk'}</h2>
            {message && <div className="bg-green-100 text-green-700 p-3 rounded-lg mb-4">{message}</div>}
            <form onSubmit={handleAddOrUpdateProduct} className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
                <div><label className="block text-gray-700">Nama Produk</label><input type="text" value={currentProduct.name} onChange={(e) => setCurrentProduct({ ...currentProduct, name: e.target.value })} className="w-full p-2 border rounded-lg" required /></div>
                <div><label className="block text-gray-700">Harga per Unit</label><input type="number" step="0.01" value={currentProduct.price} onChange={(e) => setCurrentProduct({ ...currentProduct, price: parseFloat(e.target.value) || 0 })} className="w-full p-2 border rounded-lg" required /></div>
                <div><label className="block text-gray-700">Metode Hitung</label><select value={currentProduct.calculationMethod} onChange={(e) => setCurrentProduct({ ...currentProduct, calculationMethod: e.target.value })} className="w-full p-2 border rounded-lg"><option value="dimensi">Dimensi</option><option value="paket">Paket</option><option value="satuan">Satuan</option></select></div>
                <div className="flex items-end space-x-2"><button type="submit" className="w-full bg-blue-500 text-white font-bold py-2 rounded-lg hover:bg-blue-600">{isEditing ? 'Simpan' : 'Tambah'}</button>{isEditing && (<button type="button" onClick={handleResetForm} className="bg-gray-500 text-white font-bold py-2 px-4 rounded-lg hover:bg-gray-600">Batal</button>)}</div>
            </form>
            <h3 className="text-xl font-bold mb-2">Daftar Produk</h3>
            <div className="overflow-x-auto">
                <table className="min-w-full bg-white rounded-lg shadow">
                    <thead><tr className="bg-gray-200 text-gray-600 uppercase text-sm leading-normal"><th className="py-3 px-6 text-left">Nama</th><th className="py-3 px-6 text-left">Harga</th><th className="py-3 px-6 text-left">Metode</th><th className="py-3 px-6 text-left">Aksi</th></tr></thead>
                    <tbody className="text-gray-600 text-sm font-light">
                        {products.map(p => (<tr key={p.id} className="border-b border-gray-200 hover:bg-gray-100"><td className="py-3 px-6 text-left">{p.name}</td><td className="py-3 px-6 text-left">Rp {p.price.toLocaleString('id-ID')}</td><td className="py-3 px-6 text-left">{p.calculationMethod}</td><td className="py-3 px-6 text-left"><button onClick={() => handleEditProduct(p)} className="text-blue-500 mr-2">Edit</button><button onClick={() => setModal({ show: true, action: () => handleDeleteProduct(p.id), itemId: p.id })} className="text-red-500">Hapus</button></td></tr>))}
                    </tbody>
                </table>
            </div>
            <Modal show={modal.show} title="Konfirmasi Hapus" message="Yakin ingin menghapus produk ini?" onConfirm={modal.action} onCancel={() => setModal({ show: false, action: null, itemId: null })} />
        </div>
    );
};

const StoreManagementPage = () => {
    const { db, appId, storeSettings } = useContext(AppContext);
    const [formData, setFormData] = useState({});
    const [message, setMessage] = useState('');

    useEffect(() => {
        if (storeSettings) {
            setFormData(storeSettings);
        }
    }, [storeSettings]);

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleImageUpload = (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onloadend = () => {
                setFormData(prev => ({ ...prev, logoUrl: reader.result }));
            };
            reader.readAsDataURL(file);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!db) return;
        try {
            const storeSettingsRef = doc(db, `artifacts/${appId}/public/data/storeSettings`, 'main');
            await setDoc(storeSettingsRef, formData, { merge: true });
            setMessage('Pengaturan toko berhasil disimpan!');
            setTimeout(() => setMessage(''), 3000);
        } catch (error) {
            console.error("Error saving store settings:", error);
            setMessage('Gagal menyimpan pengaturan toko.');
        }
    };

    return (
        <div className="bg-white rounded-xl shadow-lg p-6">
            <h2 className="text-2xl font-bold mb-4">Manajemen Toko</h2>
            {message && <div className="bg-green-100 text-green-700 p-3 rounded-lg mb-4">{message}</div>}
            <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                    <label className="block text-gray-700">Nama Toko</label>
                    <input type="text" name="storeName" value={formData.storeName || ''} onChange={handleChange} className="w-full p-2 border border-gray-300 rounded-lg" />
                </div>
                <div>
                    <label className="block text-gray-700">Alamat</label>
                    <input type="text" name="address" value={formData.address || ''} onChange={handleChange} className="w-full p-2 border border-gray-300 rounded-lg" />
                </div>
                <div>
                    <label className="block text-gray-700">Nomor Telepon</label>
                    <input type="text" name="phone" value={formData.phone || ''} onChange={handleChange} className="w-full p-2 border border-gray-300 rounded-lg" />
                </div>
                <div>
                    <label className="block text-gray-700">Catatan Struk</label>
                    <textarea name="receiptNotes" value={formData.receiptNotes || ''} onChange={handleChange} className="w-full p-2 border border-gray-300 rounded-lg" rows="3"></textarea>
                </div>
                <div>
                    <label className="block text-gray-700">Logo Toko</label>
                    <input type="file" accept="image/*" onChange={handleImageUpload} className="w-full p-2 border border-gray-300 rounded-lg" />
                    {formData.logoUrl && <img src={formData.logoUrl} alt="Logo Preview" className="mt-4 max-h-24" />}
                </div>
                <button type="submit" className="w-full bg-blue-500 text-white font-bold py-2 rounded-lg hover:bg-blue-600 transition-colors">Simpan Pengaturan</button>
            </form>
        </div>
    );
};
