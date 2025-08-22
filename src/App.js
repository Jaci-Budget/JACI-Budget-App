import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import {
  getAuth,
  signInAnonymously,
  signInWithCustomToken,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut
} from 'firebase/auth';
import {
  getFirestore,
  collection,
  addDoc,
  query,
  onSnapshot,
  orderBy,
  serverTimestamp,
  deleteDoc,
  doc,
  updateDoc,
  Timestamp // Import Timestamp for date comparisons
} from 'firebase/firestore';

// Global variables provided by the Canvas environment
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

// Utility function to convert Firebase timestamp or Date object to readable date string
const formatDate = (dateValue) => {
  if (dateValue && dateValue.toDate) { // Firebase Timestamp
    return dateValue.toDate().toLocaleDateString();
  }
  if (dateValue instanceof Date) { // JavaScript Date object
    return dateValue.toLocaleDateString();
  }
  // If it's a string in YYYY-MM-DD format, parse it
  if (typeof dateValue === 'string' && dateValue.match(/^\d{4}-\d{2}-\d{2}$/)) {
    const [year, month, day] = dateValue.split('-').map(Number);
    return new Date(year, month - 1, day).toLocaleDateString();
  }
  return 'N/A';
};

// Main App component
const App = () => {
  const [db, setDb] = useState(null);
  const [auth, setAuth] = useState(null);
  const [userId, setUserId] = useState(null);
  const [userEmail, setUserEmail] = useState(null); // To display logged-in email
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [transactions, setTransactions] = useState([]);
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('');
  const [type, setType] = useState('expense'); // 'expense' or 'income'
  const [transactionStatus, setTransactionStatus] = useState('actual'); // 'actual' or 'forecasted'
  const [transactionDate, setTransactionDate] = useState(''); // For user-selected date for forecasted items
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [modalMessage, setModalMessage] = useState('');
  const [modalAction, setModalAction] = useState(null);
  const [authMode, setAuthMode] = useState('login'); // 'login' or 'register'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState(null);

  const isInitialAuthAttempt = useRef(true); // Flag to ensure sign-in logic only runs once initially

  // Initialize Firebase and set up authentication listener
  useEffect(() => {
    try {
      const app = initializeApp(firebaseConfig);
      const firestore = getFirestore(app);
      const authentication = getAuth(app);

      setDb(firestore);
      setAuth(authentication);

      const unsubscribe = onAuthStateChanged(authentication, async (user) => {
        if (user) {
          setUserId(user.uid);
          setUserEmail(user.email);
          setIsAuthReady(true);
          setLoading(false); // Stop loading once authenticated
          setAuthError(null); // Clear any auth errors
        } else {
          setUserId(null);
          setUserEmail(null);
          setIsAuthReady(false); // Set to false to show login/register form
          setLoading(false); // Stop loading as we're now at login screen
          if (isInitialAuthAttempt.current) {
            // Only attempt anonymous/custom token sign-in on first load if no user is found
            try {
              if (initialAuthToken) {
                await signInWithCustomToken(authentication, initialAuthToken);
              } else {
                await signInAnonymously(authentication);
              }
            } catch (signInError) {
              console.error("Error signing in anonymously/custom token:", signInError);
              setAuthError("Failed to auto-sign in. Please log in or register.");
            } finally {
              isInitialAuthAttempt.current = false;
              setIsAuthReady(false); // After attempt, set to false if no user is authenticated
              setLoading(false);
            }
          } else {
            setLoading(false);
          }
        }
      });

      // Cleanup subscription on unmount
      return () => unsubscribe();
    } catch (err) {
      console.error("Failed to initialize Firebase:", err);
      setError("Failed to initialize the app. Please check console for details.");
      setLoading(false);
    }
  }, []);

  // Fetch transactions when auth is ready and db/userId are available
  useEffect(() => {
    if (isAuthReady && db && userId) {
      const fetchTransactions = () => {
        const path = `/artifacts/${appId}/users/${userId}/transactions`;
        // Order by createdAt to show most recently added items at top
        const q = query(collection(db, path), orderBy('createdAt', 'desc'));

        const unsubscribe = onSnapshot(q, (snapshot) => {
          const fetchedTransactions = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
          }));
          setTransactions(fetchedTransactions);
        }, (err) => {
          console.error("Error fetching transactions:", err);
          setError("Failed to load transactions. Please try again.");
        });

        // Cleanup subscription on unmount or when dependencies change
        return () => unsubscribe();
      };

      fetchTransactions();
    } else if (!isAuthReady && !userId && !loading) {
      // If auth not ready and not logged in, ensure transactions are cleared
      setTransactions([]);
    }
  }, [isAuthReady, db, userId, appId, loading]);

  // --- Authentication Handlers ---
  const handleRegister = async () => {
    if (!auth || !email || !password) {
      setAuthError("Please enter email and password.");
      return;
    }
    setLoading(true);
    setAuthError(null);
    try {
      await createUserWithEmailAndPassword(auth, email, password);
      setEmail('');
      setPassword('');
    } catch (err) {
      console.error("Registration error:", err);
      setAuthError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async () => {
    if (!auth || !email || !password) {
      setAuthError("Please enter email and password.");
      return;
    }
    setLoading(true);
    setAuthError(null);
    try {
      await signInWithEmailAndPassword(auth, email, password);
      setEmail('');
      setPassword('');
    } catch (err) {
      console.error("Login error:", err);
      setAuthError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    if (!auth) return;
    setLoading(true);
    setError(null);
    try {
      await signOut(auth);
      setTransactions([]); // Clear transactions on logout
      setAuthMode('login'); // Go back to login screen
    } catch (err) {
      console.error("Logout error:", err);
      setError("Failed to log out.");
    } finally {
      setLoading(false);
    }
  };

  // --- Modal Functions ---
  const showCustomModal = (message, action = null) => {
    setModalMessage(message);
    setModalAction(() => action);
    setShowModal(true);
  };

  const hideCustomModal = () => {
    setShowModal(false);
    setModalMessage('');
    setModalAction(null);
  };

  const handleModalConfirm = () => {
    if (modalAction) {
      modalAction();
    }
    hideCustomModal();
  };

  // --- Transaction Management Functions ---
  const handleAddTransaction = async () => {
    if (!db || !userId) {
      showCustomModal("Please log in to add transactions.");
      return;
    }
    if (!amount || isNaN(amount) || parseFloat(amount) <= 0) {
      showCustomModal("Please enter a valid positive amount.");
      return;
    }
    if (!category.trim()) {
      showCustomModal("Please enter a category.");
      return;
    }
    if (transactionStatus === 'forecasted' && !transactionDate) {
      showCustomModal("Please select a date for forecasted transactions.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Determine the effective date for the transaction based on its status
      const effectiveDate = transactionStatus === 'forecasted' && transactionDate ?
        Timestamp.fromDate(new Date(transactionDate + 'T12:00:00')) : // Add T12:00:00 to avoid timezone issues for simple date input
        serverTimestamp(); // For actual transactions, use server timestamp

      const transactionData = {
        amount: parseFloat(amount),
        category: category.trim(),
        type: type, // 'expense' or 'income'
        status: transactionStatus, // 'actual' or 'forecasted'
        date: effectiveDate, // This is the date the transaction happens or is expected
        createdAt: serverTimestamp(), // This is when the record was added to the database, for list ordering
      };
      const path = `/artifacts/${appId}/users/${userId}/transactions`;
      await addDoc(collection(db, path), transactionData);
      setAmount('');
      setCategory('');
      setType('expense');
      setTransactionStatus('actual'); // Reset to actual after adding
      setTransactionDate(''); // Clear date input
    } catch (err) {
      console.error("Error adding transaction:", err);
      setError("Failed to add transaction. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteTransaction = (id) => {
    showCustomModal("Are you sure you want to delete this transaction?", async () => {
      if (!db || !userId) {
        setError("Database or user not ready for deletion.");
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const path = `/artifacts/${appId}/users/${userId}/transactions`;
        await deleteDoc(doc(db, path, id));
      } catch (err) {
        console.error("Error deleting transaction:", err);
        setError("Failed to delete transaction. Please try again.");
      } finally {
        setLoading(false);
      }
    });
  };

  // --- Summary Calculations ---
  const totalIncome = transactions
    .filter(t => t.type === 'income' && t.status === 'actual')
    .reduce((acc, t) => acc + (t.amount || 0), 0);

  const totalExpenses = transactions
    .filter(t => t.type === 'expense' && t.status === 'actual')
    .reduce((acc, t) => acc + (t.amount || 0), 0);

  const balance = totalIncome - totalExpenses;

  // --- Cash Flow for last 30 days (Actual) ---
  const getActualCashFlowForLast30Days = () => {
    const thirtyDaysAgo = Timestamp.fromDate(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
    let incomeLast30Days = 0;
    let expensesLast30Days = 0;

    transactions.forEach(t => {
      if (t.status === 'actual' && t.date && t.date.toDate && t.date.toDate() >= thirtyDaysAgo.toDate()) {
        if (t.type === 'income') {
          incomeLast30Days += (t.amount || 0);
        } else if (t.type === 'expense') {
          expensesLast30Days += (t.amount || 0);
        }
      }
    });
    return { income: incomeLast30Days, expenses: expensesLast30Days, net: incomeLast30Days - expensesLast30Days };
  };

  const actualCashFlow30Days = getActualCashFlowForLast30Days();

  // --- Cash Flow Forecast for next 30 days ---
  const getForecastCashFlowForNext30Days = () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Normalize to start of today
    const thirtyDaysFromNow = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    thirtyDaysFromNow.setHours(23, 59, 59, 999); // Normalize to end of 30 days from now

    let anticipatedIncome = 0;
    let anticipatedExpenses = 0;

    transactions.forEach(t => {
      if (t.status === 'forecasted' && t.date && t.date.toDate) {
        const forecastDate = t.date.toDate();
        // Check if forecastDate is between today (inclusive) and 30 days from now (inclusive)
        if (forecastDate >= today && forecastDate <= thirtyDaysFromNow) {
          if (t.type === 'income') {
            anticipatedIncome += (t.amount || 0);
          } else if (t.type === 'expense') {
            anticipatedExpenses += (t.amount || 0);
          }
        }
      }
    });
    return { income: anticipatedIncome, expenses: anticipatedExpenses, net: anticipatedIncome - anticipatedExpenses };
  };

  const forecastCashFlow30Days = getForecastCashFlowForNext30Days();

  if (loading && !isAuthReady && !userId) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-100 font-inter">
        <div className="text-xl text-gray-700">Initializing app and checking authentication...</div>
      </div>
    );
  }

  // Render authentication form if not logged in
  if (!userId || !isAuthReady) {
    return (
      <div className="min-h-screen bg-gray-100 flex flex-col items-center justify-center p-4 font-inter">
        <script src="https://cdn.tailwindcss.com"></script>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
        <style>
          {`
            body { font-family: 'Inter', sans-serif; }
            .rounded-lg { border-radius: 0.5rem; }
            .shadow-lg { box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05); }
            .transition-all { transition-property: all; transition-duration: 0.3s; ease-in-out; }
          `}
        </style>
        <div className="w-full max-w-sm bg-white rounded-lg shadow-lg p-6">
          <h1 className="text-3xl font-bold text-gray-800 mb-6 text-center">Budget Tracker</h1>
          <h2 className="text-xl font-semibold text-gray-700 mb-4 text-center">
            {authMode === 'login' ? 'Log In' : 'Register'}
          </h2>
          {authError && <p className="text-red-600 text-center mb-4">{authError}</p>}
          <div className="mb-3">
            <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email"
              id="email"
              className="w-full p-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 transition-all"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
            />
          </div>
          <div className="mb-4">
            <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <input
              type="password"
              id="password"
              className="w-full p-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 transition-all"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="********"
            />
          </div>
          {authMode === 'login' ? (
            <button
              onClick={handleLogin}
              className="w-full bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 flex items-center justify-center"
              disabled={loading}
            >
              {loading ? (
                <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              ) : (
                'Log In'
              )}
            </button>
          ) : (
            <button
              onClick={handleRegister}
              className="w-full bg-green-600 text-white py-2 rounded-lg hover:bg-green-700 transition-all focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 flex items-center justify-center"
              disabled={loading}
            >
              {loading ? (
                <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              ) : (
                'Register'
              )}
            </button>
          )}
          <button
            onClick={() => setAuthMode(authMode === 'login' ? 'register' : 'login')}
            className="w-full mt-4 text-blue-600 hover:underline text-sm"
          >
            {authMode === 'login' ? 'Need an account? Register' : 'Already have an account? Log In'}
          </button>
        </div>
      </div>
    );
  }


  return (
    <div className="min-h-screen bg-gray-100 flex flex-col items-center p-4 font-inter">
      {/* Tailwind CSS CDN */}
      <script src="https://cdn.tailwindcss.com"></script>

      {/* Font Inter */}
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
      <style>
        {`
          body { font-family: 'Inter', sans-serif; }
          .rounded-lg { border-radius: 0.5rem; }
          .shadow-lg { box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05); }
          .transition-all { transition-property: all; transition-duration: 0.3s; ease-in-out; }
          .hover\\:shadow-md\\:hover { box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06); }
        `}
      </style>

      <div className="w-full max-w-md bg-white rounded-lg shadow-lg p-6 mb-6">
        <h1 className="text-3xl font-bold text-gray-800 mb-4 text-center">Budget Tracker</h1>
        {userEmail && (
          <p className="text-sm text-gray-600 text-center mb-2">Logged in as: <span className="font-medium">{userEmail}</span></p>
        )}
        {userId && (
            <p className="text-xs text-gray-500 text-center mb-4 truncate" title={userId}>
              User ID: {userId}
            </p>
          )}
        <button
          onClick={handleLogout}
          className="w-full bg-red-500 text-white py-2 rounded-lg hover:bg-red-600 transition-all focus:outline-none focus:ring-2 focus:ring-red-400 focus:ring-offset-2 mb-6"
          disabled={loading}
        >
          Log Out
        </button>


        {/* Summary Section */}
        <div className="grid grid-cols-3 gap-4 text-center mb-6">
          <div className="p-3 bg-blue-100 rounded-lg shadow-sm">
            <p className="text-sm text-blue-700">Total Income</p>
            <p className="text-lg font-semibold text-blue-800">${totalIncome.toFixed(2)}</p>
          </div>
          <div className="p-3 bg-red-100 rounded-lg shadow-sm">
            <p className="text-sm text-red-700">Total Expenses</p>
            <p className="text-lg font-semibold text-red-800">${totalExpenses.toFixed(2)}</p>
          </div>
          <div className={`p-3 rounded-lg shadow-sm ${balance >= 0 ? 'bg-green-100' : 'bg-orange-100'}`}>
            <p className="text-sm text-gray-700">Current Balance</p>
            <p className={`text-lg font-semibold ${balance >= 0 ? 'text-green-800' : 'text-orange-800'}`}>${balance.toFixed(2)}</p>
          </div>
        </div>

        {/* Cash Flow for Last 30 Days (Actual) */}
        <div className="mb-6 p-4 border border-gray-200 rounded-lg shadow-inner bg-blue-50">
          <h2 className="text-xl font-semibold text-blue-800 mb-4 text-center">Actual Cash Flow (Last 30 Days)</h2>
          <div className="grid grid-cols-2 gap-4 text-center">
            <div className="p-3 bg-blue-100 rounded-lg shadow-sm">
              <p className="text-sm text-blue-700">Income</p>
              <p className="text-lg font-semibold text-blue-800">${actualCashFlow30Days.income.toFixed(2)}</p>
            </div>
            <div className="p-3 bg-red-100 rounded-lg shadow-sm">
              <p className="text-sm text-red-700">Expenses</p>
              <p className="text-lg font-semibold text-red-800">${actualCashFlow30Days.expenses.toFixed(2)}</p>
            </div>
          </div>
          <div className={`p-3 rounded-lg shadow-sm mt-4 text-center ${actualCashFlow30Days.net >= 0 ? 'bg-green-100' : 'bg-orange-100'}`}>
            <p className="text-sm text-gray-700">Net Flow</p>
            <p className={`text-lg font-semibold ${actualCashFlow30Days.net >= 0 ? 'text-green-800' : 'text-orange-800'}`}>${actualCashFlow30Days.net.toFixed(2)}</p>
          </div>
        </div>

        {/* Cash Flow Forecast for Next 30 Days */}
        <div className="mb-6 p-4 border border-gray-200 rounded-lg shadow-inner bg-purple-50">
          <h2 className="text-xl font-semibold text-purple-800 mb-4 text-center">Forecasted Cash Flow (Next 30 Days)</h2>
          <div className="grid grid-cols-2 gap-4 text-center">
            <div className="p-3 bg-purple-100 rounded-lg shadow-sm">
              <p className="text-sm text-purple-700">Anticipated Income</p>
              <p className="text-lg font-semibold text-purple-800">${forecastCashFlow30Days.income.toFixed(2)}</p>
            </div>
            <div className="p-3 bg-purple-100 rounded-lg shadow-sm">
              <p className="text-sm text-purple-700">Anticipated Expenses</p>
              <p className="text-lg font-semibold text-purple-800">${forecastCashFlow30Days.expenses.toFixed(2)}</p>
            </div>
          </div>
          <div className={`p-3 rounded-lg shadow-sm mt-4 text-center ${forecastCashFlow30Days.net >= 0 ? 'bg-green-100' : 'bg-orange-100'}`}>
            <p className="text-sm text-gray-700">Net Forecast</p>
            <p className={`text-lg font-semibold ${forecastCashFlow30Days.net >= 0 ? 'text-green-800' : 'text-orange-800'}`}>${forecastCashFlow30Days.net.toFixed(2)}</p>
          </div>
        </div>


        {/* Add Transaction Form */}
        <div className="mb-6 p-4 border border-gray-200 rounded-lg shadow-inner">
          <h2 className="text-xl font-semibold text-gray-700 mb-4">Add New Transaction</h2>
          <div className="mb-3">
            <label htmlFor="amount" className="block text-sm font-medium text-gray-700 mb-1">Amount</label>
            <input
              type="number"
              id="amount"
              className="w-full p-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 transition-all"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="e.g., 50.00"
            />
          </div>
          <div className="mb-3">
            <label htmlFor="category" className="block text-sm font-medium text-gray-700 mb-1">Category</label>
            <input
              type="text"
              id="category"
              className="w-full p-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 transition-all"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="e.g., Groceries, Salary, Rent"
            />
          </div>
          <div className="mb-4">
            <label htmlFor="type" className="block text-sm font-medium text-gray-700 mb-1">Type</label>
            <select
              id="type"
              className="w-full p-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 transition-all"
              value={type}
              onChange={(e) => setType(e.target.value)}
            >
              <option value="expense">Expense</option>
              <option value="income">Income</option>
            </select>
          </div>
          <div className="mb-4">
            <label htmlFor="transactionStatus" className="block text-sm font-medium text-gray-700 mb-1">Status</label>
            <div className="flex space-x-4">
              <label className="inline-flex items-center">
                <input
                  type="radio"
                  name="transactionStatus"
                  value="actual"
                  checked={transactionStatus === 'actual'}
                  onChange={(e) => setTransactionStatus(e.target.value)}
                  className="form-radio text-blue-600"
                />
                <span className="ml-2 text-gray-700">Actual</span>
              </label>
              <label className="inline-flex items-center">
                <input
                  type="radio"
                  name="transactionStatus"
                  value="forecasted"
                  checked={transactionStatus === 'forecasted'}
                  onChange={(e) => setTransactionStatus(e.target.value)}
                  className="form-radio text-blue-600"
                />
                <span className="ml-2 text-gray-700">Forecasted</span>
              </label>
            </div>
          </div>
          {transactionStatus === 'forecasted' && (
            <div className="mb-4">
              <label htmlFor="transactionDate" className="block text-sm font-medium text-gray-700 mb-1">Anticipated Date</label>
              <input
                type="date"
                id="transactionDate"
                className="w-full p-2 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 transition-all"
                value={transactionDate}
                onChange={(e) => setTransactionDate(e.target.value)}
              />
            </div>
          )}
          <button
            onClick={handleAddTransaction}
            className="w-full bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 flex items-center justify-center"
            disabled={loading}
          >
            {loading ? (
              <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            ) : (
              'Add Transaction'
            )}
          </button>
        </div>

        {/* Transaction List */}
        <div>
          <h2 className="text-xl font-semibold text-gray-700 mb-4">Transactions</h2>
          {transactions.length === 0 && !loading && (
            <p className="text-gray-500 text-center">No transactions yet. Add one above!</p>
          )}
          {loading && transactions.length === 0 && (
            <div className="flex justify-center items-center">
              <svg className="animate-spin h-6 w-6 text-blue-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <span className="ml-2 text-gray-600">Loading transactions...</span>
            </div>
          )}
          <ul className="space-y-3">
            {transactions.map((t) => (
              <li
                key={t.id}
                className={`flex justify-between items-center p-4 rounded-lg shadow-sm transition-all hover:shadow-md ${
                  t.type === 'income' ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'
                } ${t.status === 'forecasted' ? 'opacity-75 border-dashed border-gray-400' : ''}`}
              >
                <div>
                  <p className="text-lg font-medium text-gray-800 capitalize">
                    {t.category}
                    {t.status === 'forecasted' && <span className="text-xs text-gray-500 ml-2">(Forecast)</span>}
                  </p>
                  <p className="text-sm text-gray-500">{formatDate(t.date)}</p> {/* Display transaction date */}
                </div>
                <div className="flex items-center">
                  <span className={`text-lg font-semibold ${t.type === 'income' ? 'text-green-600' : 'text-red-600'}`}>
                    {t.type === 'income' ? '+' : '-'}${Math.abs(t.amount || 0).toFixed(2)}
                  </span>
                  <button
                    onClick={() => handleDeleteTransaction(t.id)}
                    className="ml-4 p-2 rounded-full bg-gray-200 text-gray-600 hover:bg-gray-300 transition-all focus:outline-none focus:ring-2 focus:ring-gray-400 focus:ring-offset-2"
                    aria-label="Delete transaction"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-5 w-5"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                    >
                      <path
                        fillRule="evenodd"
                        d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm6 0a1 1 0 11-2 0v6a1 1 0 112 0V8z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Custom Confirmation Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-75 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 m-4 max-w-sm w-full">
            <h3 className="text-lg font-semibold text-gray-800 mb-4">Confirmation</h3>
            <p className="text-gray-700 mb-6">{modalMessage}</p>
            <div className="flex justify-end space-x-3">
              <button
                onClick={hideCustomModal}
                className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleModalConfirm}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-all"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
