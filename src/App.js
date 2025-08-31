import React, { useState, useEffect } from 'react';
import {
  getFirestore,
  collection,
  query,
  where,
  onSnapshot,
  doc,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc
} from 'firebase/firestore';
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged,
  signInWithCustomToken
} from 'firebase/auth';
import { initializeApp } from 'firebase/app';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer
} from 'recharts';

// Global variables provided by the Canvas environment.
// For local development, we provide placeholder values.
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

// Initialize Firebase only once
let app, auth, db;
try {
  app = initializeApp(firebaseConfig);
  db = getFirestore(app);
  auth = getAuth(app);
} catch (error) {
  console.error('Firebase initialization failed:', error);
}

// Function to convert Firestore Timestamp to a formatted date string
const formatDate = (timestamp) => {
  const date = timestamp?.toDate ? timestamp.toDate() : timestamp;
  if (!(date instanceof Date) || isNaN(date)) {
    return 'Invalid Date';
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

// Main App component
const App = () => {
  const [user, setUser] = useState(null);
  const [budget, setBudget] = useState(0);
  const [income, setIncome] = useState(0);
  const [expense, setExpense] = useState(0);
  const [items, setItems] = useState([]);
  const [filteredItems, setFilteredItems] = useState([]);
  const [forecastItems, setForecastItems] = useState([]);
  const [filterType, setFilterType] = useState('all'); // 'all', 'income', 'expense'
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [message, setMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Firestore paths for the current user
  const getUserDataPath = (collectionName) => {
    const userId = user?.uid || 'anonymous';
    const collectionId = `artifacts/${appId}/users/${userId}/${collectionName}`;
    return collection(db, collectionId);
  };

  // Authenticate user and listen for changes
  useEffect(() => {
    if (!auth) return;

    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        console.log("Authenticated as:", currentUser.uid);
        setUser(currentUser);
        setIsAuthReady(true);
      } else {
        console.log("Attempting anonymous sign-in...");
        try {
          if (initialAuthToken) {
            await signInWithCustomToken(auth, initialAuthToken);
          } else {
            await signInAnonymously(auth);
          }
        } catch (error) {
          console.error("Authentication failed", error);
        }
      }
    });

    return () => unsubscribe();
  }, []);

  // Set up real-time listeners for budget data
  useEffect(() => {
    if (!isAuthReady || !user || !db) return;

    // Listener for Budget, Income, and Expense
    const budgetDocRef = doc(getUserDataPath('budgets'), 'summary');
    const unsubscribeSummary = onSnapshot(budgetDocRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setBudget(data.budget || 0);
        setIncome(data.income || 0);
        setExpense(data.expense || 0);
      } else {
        // Initialize budget summary if it doesn't exist
        setDoc(budgetDocRef, { budget: 0, income: 0, expense: 0 });
      }
    });

    // Listener for all items
    const itemsCollectionRef = getUserDataPath('items');
    const unsubscribeItems = onSnapshot(itemsCollectionRef, (snapshot) => {
      const itemsList = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      const sortedItems = itemsList.sort((a, b) => (b.date?.toDate() || 0) - (a.date?.toDate() || 0));
      setItems(sortedItems);
    });

    return () => {
      unsubscribeSummary();
      unsubscribeItems();
    };
  }, [isAuthReady, user]);

  // Handle item filtering based on type
  useEffect(() => {
    if (filterType === 'all') {
      setFilteredItems(items);
    } else {
      const filtered = items.filter((item) => item.type === filterType);
      setFilteredItems(filtered);
    }
  }, [items, filterType]);

  // Handle budget item creation/update
  const handleAddItem = async (e) => {
    e.preventDefault();
    const form = e.target;
    const formData = new FormData(form);
    const date = new Date(formData.get('date'));
    const amount = parseFloat(formData.get('amount'));
    const type = formData.get('type');
    const description = formData.get('description');

    if (isNaN(amount) || amount <= 0 || !description || !date) {
      showMessage('Please enter a valid amount and description.', 'error');
      return;
    }

    setIsLoading(true);
    try {
      // Add or update the budget item
      await addDoc(getUserDataPath('items'), {
        date,
        amount,
        type,
        description,
      });

      // Update the budget summary
      const budgetDocRef = doc(getUserDataPath('budgets'), 'summary');
      await setDoc(budgetDocRef, {
        budget: type === 'income' ? budget + amount : budget - amount,
        income: type === 'income' ? income + amount : income,
        expense: type === 'expense' ? expense + amount : expense,
      }, { merge: true });

      showMessage('Item added successfully!');
      form.reset();
    } catch (e) {
      showMessage('Error adding item.', 'error');
      console.error("Error adding document: ", e);
    } finally {
      setIsLoading(false);
    }
  };

  const handleForecast = async () => {
    setIsLoading(true);
    const userPrompt = `Based on the following financial transactions, predict the user's budget, income, and expenses for the next 3 months, based on their spending and earning trends. Provide the output as a JSON array of objects, with each object representing a month. Each object should have 'month', 'predictedBudget', 'predictedIncome', and 'predictedExpense'. Do not include any text before or after the JSON.
    Transactions: ${JSON.stringify(items.map(item => ({ type: item.type, amount: item.amount, description: item.description, date: formatDate(item.date) })))}`;

    try {
      const payload = {
        contents: [{ parts: [{ text: userPrompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                "month": { "type": "STRING" },
                "predictedBudget": { "type": "NUMBER" },
                "predictedIncome": { "type": "NUMBER" },
                "predictedExpense": { "type": "NUMBER" }
              }
            }
          }
        },
      };
      
      const apiKey = "";
      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`;

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      const result = await response.json();
      const text = result?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) {
        setForecastItems(JSON.parse(text));
        showMessage('Forecast generated successfully!');
      } else {
        throw new Error('No content returned from API');
      }
    } catch (e) {
      console.error("Error generating forecast:", e);
      showMessage('Failed to generate forecast.', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const showMessage = (text, type = 'success') => {
    setMessage(text);
    setTimeout(() => setMessage(''), 3000);
  };

  const forecastData = [
    ...forecastItems.map(item => ({
      ...item,
      color: '#3490dc' // Blue
    }))
  ];

  return (
    <div className="min-h-screen bg-gray-900 text-white font-sans flex flex-col items-center p-4 sm:p-6">
      <div className="w-full max-w-4xl space-y-8">
        <header className="text-center">
          <h1 className="text-4xl sm:text-5xl font-extrabold text-blue-400">JACI Budgeting</h1>
          <p className="mt-2 text-lg text-gray-400">Personal Finance & Forecasting</p>
        </header>

        <section className="bg-gray-800 p-6 rounded-3xl shadow-lg border border-gray-700">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-2xl font-bold text-gray-200">Summary</h2>
            <div className="text-sm text-gray-400">
              <p>User ID: {user?.uid || 'Loading...'}</p>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-center">
            <div className="p-4 rounded-xl bg-blue-700 bg-opacity-30 shadow-inner">
              <p className="text-blue-200 font-medium">Budget</p>
              <p className="text-3xl font-bold text-blue-400 mt-1">${budget.toFixed(2)}</p>
            </div>
            <div className="p-4 rounded-xl bg-green-700 bg-opacity-30 shadow-inner">
              <p className="text-green-200 font-medium">Income</p>
              <p className="text-3xl font-bold text-green-400 mt-1">${income.toFixed(2)}</p>
            </div>
            <div className="p-4 rounded-xl bg-red-700 bg-opacity-30 shadow-inner">
              <p className="text-red-200 font-medium">Expenses</p>
              <p className="text-3xl font-bold text-red-400 mt-1">${expense.toFixed(2)}</p>
            </div>
          </div>
        </section>

        <section className="bg-gray-800 p-6 rounded-3xl shadow-lg border border-gray-700">
          <h2 className="text-2xl font-bold text-gray-200 mb-4">Add Transaction</h2>
          <form onSubmit={handleAddItem} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <input type="text" name="description" placeholder="Description" required className="p-3 rounded-xl bg-gray-900 border border-gray-700 text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"/>
              <input type="number" name="amount" placeholder="Amount ($)" step="0.01" required className="p-3 rounded-xl bg-gray-900 border border-gray-700 text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"/>
              <select name="type" className="p-3 rounded-xl bg-gray-900 border border-gray-700 text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="expense">Expense</option>
                <option value="income">Income</option>
              </select>
              <input type="date" name="date" required className="p-3 rounded-xl bg-gray-900 border border-gray-700 text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"/>
            </div>
            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-blue-600 text-white font-bold py-3 rounded-xl hover:bg-blue-700 transition duration-300 disabled:bg-gray-500 disabled:cursor-not-allowed shadow-md"
            >
              {isLoading ? 'Adding...' : 'Add Transaction'}
            </button>
          </form>
        </section>

        <section className="bg-gray-800 p-6 rounded-3xl shadow-lg border border-gray-700">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-2xl font-bold text-gray-200">Transaction History</h2>
            <div className="flex space-x-2">
              <button onClick={() => setFilterType('all')} className={`py-2 px-4 rounded-xl transition duration-300 ${filterType === 'all' ? 'bg-blue-600 text-white' : 'bg-gray-900 text-gray-400 hover:bg-gray-700'}`}>All</button>
              <button onClick={() => setFilterType('income')} className={`py-2 px-4 rounded-xl transition duration-300 ${filterType === 'income' ? 'bg-blue-600 text-white' : 'bg-gray-900 text-gray-400 hover:bg-gray-700'}`}>Income</button>
              <button onClick={() => setFilterType('expense')} className={`py-2 px-4 rounded-xl transition duration-300 ${filterType === 'expense' ? 'bg-blue-600 text-white' : 'bg-gray-900 text-gray-400 hover:bg-gray-700'}`}>Expense</button>
            </div>
          </div>
          <div className="max-h-80 overflow-y-auto">
            <ul className="space-y-3">
              {filteredItems.map((item) => (
                <li key={item.id} className="bg-gray-900 p-4 rounded-xl flex justify-between items-center border border-gray-700">
                  <div>
                    <p className="font-semibold text-gray-200">{item.description}</p>
                    <p className="text-sm text-gray-400">{formatDate(item.date)}</p>
                  </div>
                  <div className={`font-bold text-lg ${item.type === 'income' ? 'text-green-400' : 'text-red-400'}`}>
                    {item.type === 'income' ? '+' : '-'}${item.amount.toFixed(2)}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>
        
        <section className="bg-gray-800 p-6 rounded-3xl shadow-lg border border-gray-700">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-2xl font-bold text-gray-200">Budget Forecast</h2>
            <button
              onClick={handleForecast}
              disabled={isLoading}
              className="bg-blue-600 text-white font-bold py-2 px-4 rounded-xl hover:bg-blue-700 transition duration-300 disabled:bg-gray-500 disabled:cursor-not-allowed shadow-md"
            >
              {isLoading ? 'Forecasting...' : 'Generate Forecast'}
            </button>
          </div>
          <div className="h-80 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={forecastData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#4a5568" />
                <XAxis dataKey="month" stroke="#cbd5e0" />
                <YAxis stroke="#cbd5e0" />
                <Tooltip contentStyle={{ backgroundColor: '#2d3748', border: 'none', borderRadius: '0.5rem' }} />
                <Line type="monotone" dataKey="predictedBudget" stroke="#4299e1" strokeWidth={2} name="Predicted Budget" />
                <Line type="monotone" dataKey="predictedIncome" stroke="#48bb78" strokeWidth={2} name="Predicted Income" />
                <Line type="monotone" dataKey="predictedExpense" stroke="#f56565" strokeWidth={2} name="Predicted Expense" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>

        {message && (
          <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-gray-900 text-white p-4 rounded-xl shadow-lg transition-transform duration-300 transform">
            {message}
          </div>
        )}
      </div>
    </div>
  );
};

export default App;
