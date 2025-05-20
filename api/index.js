const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

// Инициализация приложения Express
const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Путь к базе данных
const dbPath = path.join(__dirname, '..', 'db', 'crm.sqlite');
const dbDir = path.join(__dirname, '..', 'db');

// Убедимся, что директория для БД существует
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// Подключение к базе данных
let db;
try {
  db = new Database(dbPath);
  console.log('Успешное подключение к базе данных SQLite');
  initDb();
} catch (err) {
  console.error('Ошибка при подключении к базе данных:', err.message);
}

// Инициализация базы данных
function initDb() {
  console.log('Инициализация базы данных...');
  
  // Включаем поддержку внешних ключей
  db.pragma('foreign_keys = ON');
  
  // Создание таблицы пользователей
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      phone TEXT PRIMARY KEY,
      name TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  
  // Создание таблицы сделок
  db.exec(`
    CREATE TABLE IF NOT EXISTS deals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      amount REAL NOT NULL,
      currency TEXT DEFAULT '$',
      stage_index INTEGER DEFAULT 0,
      buyer_phone TEXT,
      supplier_phone TEXT,
      created_by TEXT NOT NULL,
      transfer INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by) REFERENCES users (phone)
    )
  `);
  
  // Создание таблицы сообщений
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deal_id INTEGER NOT NULL,
      sender TEXT NOT NULL,
      text TEXT NOT NULL,
      timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      is_read INTEGER DEFAULT 0,
      FOREIGN KEY (deal_id) REFERENCES deals (id) ON DELETE CASCADE,
      FOREIGN KEY (sender) REFERENCES users (phone)
    )
  `);
  
  // Создание индексов
  db.exec('CREATE INDEX IF NOT EXISTS idx_messages_deal_id ON messages (deal_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_deals_created_by ON deals (created_by)');
  
  // Проверяем, есть ли уже пользователи в базе
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get();
  
  // Если пользователей нет, добавляем тестовых
  if (userCount.count === 0) {
    console.log('Добавление тестовых пользователей...');
    db.prepare("INSERT INTO users (phone, name) VALUES (?, ?)").run('79001234567', 'Пользователь 1');
    db.prepare("INSERT INTO users (phone, name) VALUES (?, ?)").run('79009876543', 'Пользователь 2');
  }
  
  console.log('Инициализация базы данных завершена');
}

// API для пользователей
app.post('/api/login', (req, res) => {
  const { phone } = req.body;
  
  if (!phone) {
    return res.status(400).json({ error: 'Номер телефона обязателен' });
  }
  
  try {
    // Проверяем, существует ли пользователь
    const user = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
    
    if (user) {
      // Пользователь существует, возвращаем его данные
      return res.json({ status: 'ok', user });
    } else {
      // Пользователь не существует, создаем нового
      const stmt = db.prepare('INSERT INTO users (phone) VALUES (?)');
      stmt.run(phone);
      
      // Возвращаем данные нового пользователя
      const newUser = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
      return res.json({ status: 'ok', user: newUser });
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.get('/api/users', (req, res) => {
  try {
    const users = db.prepare('SELECT * FROM users').all();
    res.json({ status: 'ok', users });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API для сделок
app.get('/api/deals', (req, res) => {
  try {
    const deals = db.prepare('SELECT * FROM deals ORDER BY id DESC').all();
    res.json({ status: 'ok', deals });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/deals', (req, res) => {
  const { name, amount, currency, created_by } = req.body;
  
  if (!name || !amount || !created_by) {
    return res.status(400).json({ error: 'Название, сумма и создатель обязательны' });
  }
  
  try {
    const stmt = db.prepare(
      'INSERT INTO deals (name, amount, currency, created_by, stage_index) VALUES (?, ?, ?, ?, 0)'
    );
    const info = stmt.run(name, amount, currency || '$', created_by);
    
    // Получаем созданную сделку
    const deal = db.prepare('SELECT * FROM deals WHERE id = ?').get(info.lastInsertRowid);
    res.json({ status: 'ok', deal });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/deals/:id', (req, res) => {
  const { id } = req.params;
  const { name, amount, currency, stage_index, buyer_phone, supplier_phone } = req.body;
  
  // Формируем SQL запрос динамически на основе предоставленных полей
  let sql = 'UPDATE deals SET ';
  const params = [];
  const fields = [];
  
  if (name !== undefined) {
    fields.push('name = ?');
    params.push(name);
  }
  
  if (amount !== undefined) {
    fields.push('amount = ?');
    params.push(amount);
  }
  
  if (currency !== undefined) {
    fields.push('currency = ?');
    params.push(currency);
  }
  
  if (stage_index !== undefined) {
    fields.push('stage_index = ?');
    params.push(stage_index);
  }
  
  if (buyer_phone !== undefined) {
    fields.push('buyer_phone = ?');
    params.push(buyer_phone);
  }
  
  if (supplier_phone !== undefined) {
    fields.push('supplier_phone = ?');
    params.push(supplier_phone);
  }
  
  if (fields.length === 0) {
    return res.status(400).json({ error: 'Нет данных для обновления' });
  }
  
  sql += fields.join(', ') + ' WHERE id = ?';
  params.push(id);
  
  try {
    const stmt = db.prepare(sql);
    const info = stmt.run(...params);
    
    if (info.changes === 0) {
      return res.status(404).json({ error: 'Сделка не найдена' });
    }
    
    // Получаем обновленную сделку
    const deal = db.prepare('SELECT * FROM deals WHERE id = ?').get(id);
    res.json({ status: 'ok', deal });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/deals/:id', (req, res) => {
  const { id } = req.params;
  
  try {
    // Сначала удаляем все сообщения, связанные со сделкой
    db.prepare('DELETE FROM messages WHERE deal_id = ?').run(id);
    
    // Затем удаляем саму сделку
    const info = db.prepare('DELETE FROM deals WHERE id = ?').run(id);
    
    if (info.changes === 0) {
      return res.status(404).json({ error: 'Сделка не найдена' });
    }
    
    res.json({ status: 'ok', id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API для сообщений
app.get('/api/messages/:dealId', (req, res) => {
  const { dealId } = req.params;
  
  try {
    const messages = db.prepare('SELECT * FROM messages WHERE deal_id = ? ORDER BY timestamp ASC').all(dealId);
    res.json({ status: 'ok', messages });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/messages', (req, res) => {
  const { deal_id, sender, text } = req.body;
  
  if (!deal_id || !sender || !text) {
    return res.status(400).json({ error: 'ID сделки, отправитель и текст обязательны' });
  }
  
  try {
    const stmt = db.prepare(
      'INSERT INTO messages (deal_id, sender, text, timestamp, is_read) VALUES (?, ?, ?, datetime("now"), 0)'
    );
    const info = stmt.run(deal_id, sender, text);
    
    // Получаем созданное сообщение
    const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(info.lastInsertRowid);
    res.json({ status: 'ok', message });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Обработка корневого маршрута
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'CRM Chat API работает' });
});

// Обработка ошибок
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Что-то пошло не так!' });
});

// Экспорт для Vercel
module.exports = app;

// Запуск сервера при прямом вызове файла
if (require.main === module) {
  app.listen(port, '0.0.0.0', () => {
    console.log(`Сервер запущен на порту ${port}`);
  });
}
