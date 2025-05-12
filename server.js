const express = require('express');
const cors = require('cors');
const session = require('express-session');
const path = require('path');
const Database = require('better-sqlite3');
const app = express();
const port = process.env.PORT || 3000;

// Настройка middleware
app.use(cors());
app.use(express.json());

app.use(session({
  secret: 'f3c6a1d3b2c6e1f1a8d5a9c1c6f4b7c5d8a9b6e0d8f9a0b7a9e5b4c8d6a7f2', // Замени на более надёжный секрет
  resave: false,
  saveUninitialized: true,
}));

// База данных
const db = new Database('users.db');

// Таблица пользователей
db.prepare(`
    CREATE TABLE IF NOT EXISTS users (
        fullname TEXT NOT NULL,
        civilnumber TEXT PRIMARY KEY,
        avatar TEXT,
        status TEXT,
        votingStatus TEXT
    )
`).run();

// Таблица голосов
db.prepare(`
    CREATE TABLE IF NOT EXISTS votes (
        option TEXT PRIMARY KEY,
        count INTEGER
    )
`).run();

// Инициализация вариантов голосования
['option1', 'option2'].forEach(option => {
    const exists = db.prepare('SELECT 1 FROM votes WHERE option = ?').get(option);
    if (!exists) {
        db.prepare('INSERT INTO votes (option, count) VALUES (?, ?)').run(option, 0);
    }
});

// Проверка валидности ФИО
function isValidFullname(name) {
    const parts = name.trim().split(/\s+/);
    return parts.length >= 2 && parts.every(part => /^[A-Za-zА-Яа-я]{3,}$/.test(part));
}

// Проверка валидности гражданского номера
function isValidCivilnumber(number) {
    return /^[A-Za-zА-Яа-я0-9]{5}$/.test(number);
}

// Регистрация
app.post('/api/register', (req, res) => {
    const { fullname, civilnumber } = req.body;

    if (!fullname || !civilnumber) {
        return res.status(400).json({ success: false, message: 'Все поля обязательны' });
    }

    if (!isValidFullname(fullname)) {
        return res.status(400).json({ success: false, message: 'ФИО должно содержать минимум два слова, каждое минимум из 3 букв. Только буквы, без цифр и символов.' });
    }

    if (!isValidCivilnumber(civilnumber)) {
        return res.status(400).json({ success: false, message: 'Гражданский номер должен состоять ровно из 5 символов (только буквы и/или цифры).' });
    }

    const existing = db.prepare('SELECT * FROM users WHERE civilnumber = ?').get(civilnumber);
    if (existing) {
        return res.status(400).json({ success: false, message: 'Пользователь уже зарегистрирован' });
    }

    db.prepare(`
        INSERT INTO users (fullname, civilnumber, avatar, status, votingStatus)
        VALUES (?, ?, ?, ?, ?)
    `).run(fullname, civilnumber, null, 'pending', null);

    res.json({ success: true, message: 'Регистрация прошла успешно', user: { fullname, civilnumber, status: 'pending', votingStatus: null } });
});

// Модерация пользователя
app.post('/api/moderate', (req, res) => {
    const { civilnumber, action } = req.body;
    const user = db.prepare('SELECT * FROM users WHERE civilnumber = ?').get(civilnumber);
    if (!user) {
        return res.status(404).json({ success: false, message: 'Пользователь не найден' });
    }

    if (action === 'approve') {
        db.prepare('UPDATE users SET status = ?, votingStatus = ? WHERE civilnumber = ?').run('approved', 'novote', civilnumber);
        res.json({ success: true, message: 'Пользователь одобрен' });
    } else if (action === 'reject') {
        db.prepare('UPDATE users SET status = ? WHERE civilnumber = ?').run('rejected', civilnumber);
        res.json({ success: true, message: 'Пользователь отклонён' });
    } else {
        res.status(400).json({ success: false, message: 'Неверное действие' });
    }
});

// Получение пользователей на проверке
app.get('/api/pending-users', (req, res) => {
    const pendingUsers = db.prepare('SELECT * FROM users WHERE status = ?').all('pending');
    res.json({ success: true, users: pendingUsers });
});

// Обновление аватарки
app.post('/api/update-avatar', (req, res) => {
    const { civilnumber, avatar } = req.body;
    const user = db.prepare('SELECT * FROM users WHERE civilnumber = ?').get(civilnumber);
    if (!user) {
        return res.status(404).json({ success: false, message: 'Пользователь не найден' });
    }

    db.prepare('UPDATE users SET avatar = ? WHERE civilnumber = ?').run(avatar, civilnumber);
    res.json({ success: true, message: 'Аватарка обновлена', user: { ...user, avatar } });
});

// Получить всех пользователей
app.get('/api/users', (req, res) => {
    const users = db.prepare('SELECT * FROM users').all();
    res.json({ success: true, users });
});

// Удаление всех пользователей
app.delete('/api/users', (req, res) => {
    db.prepare('DELETE FROM users').run();
    res.json({ success: true, message: 'Все пользователи были удалены.' });
});

// Удаление одного пользователя
app.delete('/api/user/:civilnumber', (req, res) => {
    const { civilnumber } = req.params;
    const user = db.prepare('SELECT * FROM users WHERE civilnumber = ?').get(civilnumber);
    if (!user) {
        return res.status(404).json({ success: false, message: 'Пользователь не найден' });
    }

    db.prepare('DELETE FROM users WHERE civilnumber = ?').run(civilnumber);
    res.json({ success: true, message: 'Пользователь успешно удалён', user });
});

// Получить всю информацию о пользователе
app.get('/api/user-info/:civilnumber', (req, res) => {
    const { civilnumber } = req.params;
    const user = db.prepare('SELECT * FROM users WHERE civilnumber = ?').get(civilnumber);

    if (!user) {
        return res.status(404).json({ success: false, message: 'Пользователь не найден' });
    }

    res.json({ success: true, user });
});

// Получить статус пользователя
app.get('/api/user-status/:civilnumber', (req, res) => {
    const { civilnumber } = req.params;
    const user = db.prepare('SELECT * FROM users WHERE civilnumber = ?').get(civilnumber);

    if (!user) {
        return res.status(404).json({ success: false, message: 'Пользователь не найден' });
    }

    res.json({ success: true, status: user.status, votingStatus: user.votingStatus });
});

// Голосование
app.post('/api/vote', (req, res) => {
    const { civilnumber, option } = req.body;
    const user = db.prepare('SELECT * FROM users WHERE civilnumber = ?').get(civilnumber);

    if (!user) {
        return res.status(404).json({ success: false, message: 'Пользователь не найден' });
    }

    if (user.status !== 'approved') {
        return res.status(403).json({ success: false, message: 'Пользователь не одобрен для голосования' });
    }

    if (user.votingStatus !== 'novote') {
        return res.status(400).json({ success: false, message: 'Вы уже голосовали' });
    }

    const voteOption = db.prepare('SELECT * FROM votes WHERE option = ?').get(option);
    if (!voteOption) {
        return res.status(400).json({ success: false, message: 'Неверный вариант голосования' });
    }

    db.prepare('UPDATE votes SET count = count + 1 WHERE option = ?').run(option);
    db.prepare('UPDATE users SET votingStatus = ? WHERE civilnumber = ?').run('voted', civilnumber);

    res.json({ success: true, message: 'Голос принят' });
});

// Получение результатов голосования
app.get('/api/votes', (req, res) => {
    const result = db.prepare('SELECT * FROM votes').all();
    const formatted = {};
    result.forEach(row => {
        formatted[row.option] = row.count;
    });
    res.json({ success: true, votes: formatted });
});

// Удаление всех результатов голосования
app.delete('/api/votes', (req, res) => {
    db.prepare('UPDATE votes SET count = 0').run();
    res.json({ success: true, message: 'Все результаты голосования были сброшены.' });
});

// Сброс статуса голосования у всех пользователей
app.post('/api/reset-voting-status', (req, res) => {
    const users = db.prepare('SELECT * FROM users').all();
    let updatedCount = 0;

    users.forEach(user => {
        if (user.votingStatus === 'voted') {
            db.prepare('UPDATE users SET votingStatus = ? WHERE civilnumber = ?').run('novote', user.civilnumber);
            updatedCount++;
        }
    });

    console.log(`Сброшено статусов голосования у ${updatedCount} пользователей.`);
    res.json({ success: true, message: `Статусы голосования сброшены у ${updatedCount} пользователей.` });
});

// Middleware для защиты панели
function requireAdminAuth(req, res, next) {
  if (req.session && req.session.isAdmin) {
    next();
  } else {
    res.redirect('/admin-login.html');
  }
}

// Статическая отдача файлов
app.use(express.static(path.join(__dirname, 'VolCEC'))); // если HTML в папке public

// Логин администратора (POST)
app.post('/api/admin-login', (req, res) => {
  const { password } = req.body;

  if (password === 'SuperSecret123') { // замените на безопасный пароль
    req.session.isAdmin = true;
    res.json({ success: true });
  } else {
    res.status(401).json({ success: false, message: 'Неверный пароль' });
  }
});

// Отдача adminpanel.html только если залогинен
app.get('/adminpanel.html', requireAdminAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'VolCEC', 'adminpanel.html'));
});

// -------------------- Запуск сервера --------------------
app.listen(port, () => {
    console.log(`Сервер запущен на http://localhost:${port}`);
});
