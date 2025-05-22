const express = require('express');
const cors = require('cors');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const path = require('path');
const Database = require('better-sqlite3');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const fs = require('fs');
const app = express();

const port = process.env.PORT || 3000;
const ADMIN_PASSWORD = 'voleriarulid';
const MAIN_JS_PATH = path.join(__dirname, 'main.js');
const errorPagePath = path.join(__dirname, 'error.html');

// Security headers
app.use(helmet({ contentSecurityPolicy: false }));

// Rate limiting
app.use(rateLimit({
    windowMs: 60 * 1000,
    max: 240,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: "Слишком много запросов, попробуйте позже." }
}));

// Sessions
app.use(session({
    name: 'session',
    secret: 'f3c6a1d3b2c6e1f1a8d5a9c1c6f4b7c5d8a9b6e0d8f9a0b7a9e5b4c8d6a7f2',
    resave: false,
    saveUninitialized: false,
    store: new SQLiteStore({ db: 'sessions.sqlite', dir: './' }),
    cookie: {
        httpOnly: true,
        secure: false,
        sameSite: 'lax',
        maxAge: 1000 * 60 * 60 * 24 * 30
    }
}));

app.use(cors({
    origin: 'http://localhost:3000',
    credentials: true
}));
app.use(express.json({ limit: '10mb' }));

// CSRF Token endpoint
app.get('/api/csrf-token', (req, res) => {
    if (!req.session.csrfToken) {
        req.session.csrfToken = crypto.randomBytes(24).toString('hex');
    }
    res.json({ csrfToken: req.session.csrfToken });
});

// CSRF middleware
function checkCSRF(req, res, next) {
    const token = req.headers['x-csrf-token'];
    if (req.session && req.session.csrfToken && token === req.session.csrfToken) {
        next();
    } else {
        res.status(403).json({ success: false, message: 'Invalid CSRF token' });
    }
}

// Admin panel (access restricted)
app.get('/adminpanel.html', (req, res) => {
    const user = req.session.user;
    if (
        user &&
        user.fullname === 'Мярьянов Вадим Маркович' &&
        user.civilnumber === '00010' &&
        user.status === 'approved'
    ) {
        return res.sendFile(path.join(__dirname, 'adminpanel.html'));
    } else {
        return res.redirect('/index.html');
    }
});

// Vote page (access restricted)
app.get('/vote.html', (req, res) => {
    const user = req.session.user;
    if (!user || user.status !== 'approved') {
        return res.redirect('/elections.html');
    }
    return res.sendFile(path.join(__dirname, 'vote.html'));
});

app.use(express.static(path.join(__dirname)));

// Database setup
const db = new Database('users.db');
try { db.prepare('ALTER TABLE users ADD COLUMN password TEXT').run(); } catch (e) {}
db.prepare(`CREATE TABLE IF NOT EXISTS users (
        fullname TEXT NOT NULL,
        civilnumber TEXT PRIMARY KEY,
        avatar TEXT,
        status TEXT,
        votingStatus TEXT,
        password TEXT
    )`).run();
db.prepare("UPDATE users SET votingStatus = 'novote' WHERE votingStatus IS NULL OR votingStatus = ''").run();
db.prepare(`CREATE TABLE IF NOT EXISTS votes (
        option TEXT PRIMARY KEY,
        count INTEGER
    )`).run();
['option1', 'option2'].forEach(option => {
    const exists = db.prepare('SELECT 1 FROM votes WHERE option = ?').get(option);
    if (!exists) db.prepare('INSERT INTO votes (option, count) VALUES (?, ?)')
        .run(option, 0);
});

function isValidFullname(name) {
    const parts = name.trim().split(/\s+/);
    return parts.length >= 2 && parts.every(part => /^[A-Za-zА-Яа-я]{3,}$/.test(part));
}
function isValidCivilnumber(number) {
    return /^\d{5}$/.test(number);
}
function isValidPassword(password) {
    return typeof password === 'string' &&
        password.length >= 8 &&
        /[A-Za-zА-Яа-я]/.test(password) &&
        /\d/.test(password);
}
function saveUserToSession(req, user) {
    req.session.user = {
        fullname: user.fullname,
        civilnumber: user.civilnumber,
        avatar: user.avatar,
        status: user.status,
        votingStatus: user.votingStatus ?? 'novote'
    };
}

// API endpoints

app.get('/api/me', (req, res) => {
    if (req.session.user) {
        const user = db.prepare('SELECT * FROM users WHERE civilnumber = ?').get(req.session.user.civilnumber);
        if (user) {
            req.session.user = user;
            return res.json({ user });
        }
    }
    res.json({ user: null });
});

app.post('/api/register', (req, res) => {
    const { fullname, civilnumber, password } = req.body;
    if (!fullname || !civilnumber || !password) {
        return res.status(400).json({ success: false, message: 'Все поля обязательны' });
    }
    if (!isValidFullname(fullname)) {
        return res.status(400).json({ success: false, message: 'ФИО должно содержать минимум два слова, каждое минимум из 3 букв.' });
    }
    if (!isValidCivilnumber(civilnumber)) {
        return res.status(400).json({ success: false, message: 'Гражданский номер должен состоять из 5 цифр.' });
    }
    if (!isValidPassword(password)) {
        return res.status(400).json({ success: false, message: 'Пароль должен быть не менее 8 символов и содержать буквы и цифры.' });
    }
    const existing = db.prepare('SELECT * FROM users WHERE civilnumber = ?').get(civilnumber);
    if (existing) {
        return res.status(400).json({ success: false, message: 'Пользователь уже зарегистрирован' });
    }
    db.prepare(
        'INSERT INTO users (fullname, civilnumber, avatar, status, votingStatus, password) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(fullname, civilnumber, null, 'pending', 'novote', password);

    const user = { fullname, civilnumber, status: 'pending', votingStatus: 'novote', avatar: null };
    saveUserToSession(req, user);

    res.json({ success: true, message: 'Регистрация прошла успешно', user });
});

app.post('/api/update-avatar', checkCSRF, (req, res) => {
    const user = req.session.user;
    const { avatar } = req.body;
    if (!user) return res.status(401).json({ success: false, message: 'Нет авторизации' });
    if (!avatar || typeof avatar !== 'string' || !avatar.startsWith('data:image/')) {
        return res.status(400).json({ success: false, message: 'Некорректные данные аватара' });
    }
    db.prepare('UPDATE users SET avatar = ? WHERE civilnumber = ?').run(avatar, user.civilnumber);
    user.avatar = avatar;
    req.session.user = user;
    res.json({ success: true, message: 'Аватарка обновлена', user });
});

app.get('/api/user-status/:civilnumber', (req, res) => {
    const { civilnumber } = req.params;
    const user = db.prepare('SELECT * FROM users WHERE civilnumber = ?').get(civilnumber);
    if (!user) {
        return res.status(404).json({ success: false, message: 'Пользователь не найден' });
    }
    if (req.session.user && req.session.user.civilnumber === civilnumber) {
        req.session.user.status = user.status;
        req.session.user.votingStatus = user.votingStatus;
    }
    res.json({ success: true, status: user.status, votingStatus: user.votingStatus });
});

app.get('/api/users', (req, res) => {
    try {
        const users = db.prepare('SELECT fullname, civilnumber, avatar, status, votingStatus FROM users').all();
        res.json({ success: true, users });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Ошибка получения пользователей', error: err.message });
    }
});

app.get('/api/users/pending', (req, res) => {
    try {
        const users = db.prepare('SELECT * FROM users WHERE status = ?').all('pending');
        res.json({ success: true, users });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Ошибка получения пользователей со статусом pending', error: err.message });
    }
});

app.post('/api/vote', checkCSRF, (req, res) => {
    const sessionUser = req.session.user;
    const { option } = req.body;
    if (!sessionUser) return res.status(401).json({ success: false, message: 'Нет авторизации' });
    const user = db.prepare('SELECT * FROM users WHERE civilnumber = ?').get(sessionUser.civilnumber);
    if (!user) return res.status(404).json({ success: false, message: 'Пользователь не найден' });
    if (user.status !== 'approved')
        return res.status(403).json({ success: false, message: 'Пользователь не одобрен для голосования' });
    if (user.votingStatus === 'vote')
        return res.status(400).json({ success: false, message: 'Вы уже голосовали' });
    const voteOption = db.prepare('SELECT * FROM votes WHERE option = ?').get(option);
    if (!voteOption)
        return res.status(400).json({ success: false, message: 'Неверный вариант голосования' });
    db.prepare('UPDATE votes SET count = count + 1 WHERE option = ?').run(option);
    db.prepare('UPDATE users SET votingStatus = ? WHERE civilnumber = ?').run('vote', user.civilnumber);
    req.session.user.votingStatus = 'vote';
    res.json({ success: true, message: 'Голос принят' });
});

app.delete('/api/users', checkCSRF, (req, res) => {
    try {
        db.prepare('DELETE FROM users').run();
        if (req.session.user) req.session.destroy(() => {});
        res.json({ success: true, message: 'Все пользователи успешно удалены.' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Ошибка удаления пользователей', error: err.message });
    }
});

app.delete('/api/user/:civilnumber', checkCSRF, (req, res) => {
    const { civilnumber } = req.params;
    const user = db.prepare('SELECT * FROM users WHERE civilnumber = ?').get(civilnumber);
    if (!user) {
        return res.status(404).json({ success: false, message: 'Пользователь не найден' });
    }
    db.prepare('DELETE FROM users WHERE civilnumber = ?').run(civilnumber);
    if (req.session.user && req.session.user.civilnumber === civilnumber) req.session.destroy(() => {});
    res.json({ success: true, message: 'Пользователь успешно удалён', user });
});

app.get('/api/user-info/:civilnumber', (req, res) => {
    const { civilnumber } = req.params;
    const user = db.prepare('SELECT * FROM users WHERE civilnumber = ?').get(civilnumber);
    if (!user) {
        return res.status(404).json({ success: false, message: 'Пользователь не найден' });
    }
    res.json({ success: true, user });
});

app.get('/api/votes', (req, res) => {
    const result = db.prepare('SELECT * FROM votes').all();
    const formatted = {};
    result.forEach(row => {
        formatted[row.option] = row.count;
    });
    res.json({ success: true, votes: formatted });
});

app.delete('/api/votes', checkCSRF, (req, res) => {
    db.prepare('UPDATE votes SET count = 0').run();
    res.json({ success: true, message: 'Все результаты голосования были сброшены.' });
});

app.post('/api/reset-voting-status', checkCSRF, (req, res) => {
    const users = db.prepare('SELECT * FROM users').all();
    let updatedCount = 0;
    users.forEach(user => {
        if (user.votingStatus === 'vote') {
            db.prepare('UPDATE users SET votingStatus = ? WHERE civilnumber = ?').run('novote', user.civilnumber);
            updatedCount++;
        }
    });
    res.json({ success: true, message: `Статусы голосования сброшены у ${updatedCount} пользователей.` });
});

// Admin login and content
const issuedAdminTokens = new Set();
app.post('/api/admin-login', (req, res) => {
    const { password } = req.body;
    if (password === ADMIN_PASSWORD) {
        const token = crypto.randomBytes(24).toString('hex');
        issuedAdminTokens.add(token);
        return res.json({ success: true, token });
    }
    return res.status(403).json({ success: false, message: 'Неверный пароль' });
});

app.get('/api/admin-authenticated', (req, res) => {
    if (req.session.isAdmin) {
        return res.json({ authenticated: true });
    }
    return res.json({ authenticated: false });
});

app.get('/api/admin-content', (req, res) => {
    const token = req.headers['authorization'];
    if (token && issuedAdminTokens.has(token.replace('Bearer ', ''))) {
        return res.send(`
      <h1>Панель администратора</h1>
      <button onclick="resetVotingStatuses()">Сбросить статус голосования всем пользователям</button>
      <button onclick="deleteAllUsers()">Удалить всех пользователей (включая cookie)</button>
      <button onclick="simplifyCheck()">Запретить переход на vote.html</button>
      <button onclick="restoreCheck()">Разрешить переход на vote.html</button>
      <h3>Удаление пользователя по Civil Number</h3>
      <input type="text" id="civilInput" placeholder="Введите гражданский номер">
      <button onclick="deleteUserByCivilnumber()">Удалить пользователя</button>
    `);
    }
    return res.status(403).send('Нет доступа');
});

// Main.js check modification
app.post('/api/simplify-check', checkCSRF, (req, res) => {
    try {
        let content = fs.readFileSync(MAIN_JS_PATH, 'utf-8');
        const updated = content.replace(
            /if\s*\(\s*!user\s*\|\|\s*user\.status\s*!==\s*'approved'\s*\)\s*\{\s*window\.location\.href\s*=\s*'elections\.html';\s*return;\s*\}/,
            "window.location.href = 'elections.html';"
        );
        fs.writeFileSync(MAIN_JS_PATH, updated, 'utf-8');
        res.json({ success: true, message: 'Переход упрощён.' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Ошибка при изменении main.js', error: err.message });
    }
});

app.post('/api/restore-check', checkCSRF, (req, res) => {
    try {
        let content = fs.readFileSync(MAIN_JS_PATH, 'utf-8');
        const updated = content.replace(
            /window\.location\.href\s*=\s*'elections\.html';/,
            `if (!user || user.status !== 'approved') {
            window.location.href = 'elections.html';
        return;
        }`
        );
        fs.writeFileSync(MAIN_JS_PATH, updated, 'utf-8');
        res.json({ success: true, message: 'Переход восстановлен.' });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Ошибка при восстановлении main.js', error: err.message });
    }
});

app.post('/api/moderate', (req, res) => {
    const { civilnumber, status } = req.body;
    if (!civilnumber || !['approved', 'rejected', 'pending'].includes(status)) {
        return res.status(400).json({ success: false, message: 'Некорректные данные.' });
    }
    const user = db.prepare('SELECT * FROM users WHERE civilnumber = ?').get(civilnumber);
    if (!user) {
        return res.status(404).json({ success: false, message: 'Пользователь не найден.' });
    }
    db.prepare('UPDATE users SET status = ? WHERE civilnumber = ?')
        .run(status, civilnumber);
    if (req.session.user && req.session.user.civilnumber === civilnumber) {
        req.session.user.status = status;
    }
    res.json({ success: true, message: `Статус пользователя обновлён: ${status}` });
});

// Error handlers
app.use((req, res, next) => {
    if (req.path.startsWith('/api/')) {
        res.status(404).json({ success: false, message: 'API endpoint not found' });
    } else {
        const errorCode = 404;
        const errorMessage = encodeURIComponent('Страница не найдена');
        res.redirect(`/error.html?code=${errorCode}&message=${errorMessage}`);
    }
});

app.use((err, req, res, next) => {
    console.error(err.stack);
    if (req.path && req.path.startsWith('/api/')) {
        res.status(500).json({ success: false, message: 'Internal server error' });
    } else {
        const errorCode = 500;
        const errorMessage = encodeURIComponent('Внутренняя ошибка сервера');
        res.redirect(`/error.html?code=${errorCode}&message=${errorMessage}`);
    }
});

app.listen(port, () => {
    console.log(`Сервер запущен на http://localhost:${port}`);
});