const express = require('express');
const cors = require('cors');
const session = require('express-session');
const path = require('path');
const Database = require('better-sqlite3');
const app = express();
const port = process.env.PORT || 3000;
const crypto = require('crypto');
const ADMIN_PASSWORD = 'voleriarulid';
const fs = require('fs');
const MAIN_JS_PATH = path.join(__dirname, 'main.js');
const errorPagePath = path.join(__dirname, 'error.html');

app.use(cors({
    origin: 'http://localhost:3000',
    credentials: true
}));
app.use(express.json());
app.use(express.static(path.join(__dirname)));

app.use(session({
    name: 'session',
    secret: 'f3c6a1d3b2c6e1f1a8d5a9c1c6f4b7c5d8a9b6e0d8f9a0b7a9e5b4c8d6a7f2',
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        secure: false, // true если HTTPS
        sameSite: 'lax',
        maxAge: 1000 * 60 * 60 * 24 * 30 // 30 дней
    }
}));

// База данных
const db = new Database('users.db');
db.prepare(`
    CREATE TABLE IF NOT EXISTS users (
        fullname TEXT NOT NULL,
        civilnumber TEXT PRIMARY KEY,
        avatar TEXT,
        status TEXT,
        votingStatus TEXT
    )
`).run();
db.prepare(`
    CREATE TABLE IF NOT EXISTS votes (
        option TEXT PRIMARY KEY,
        count INTEGER
    )
`).run();

['option1', 'option2'].forEach(option => {
    const exists = db.prepare('SELECT 1 FROM votes WHERE option = ?').get(option);
    if (!exists) {
        db.prepare('INSERT INTO votes (option, count) VALUES (?, ?)')
            .run(option, 0);
    }
});

// Вспомогательные функции
function isValidFullname(name) {
    const parts = name.trim().split(/\s+/);
    return parts.length >= 2 && parts.every(part => /^[A-Za-zА-Яа-я]{3,}$/.test(part));
}
function isValidCivilnumber(number) {
    return /^\d{5}$/.test(number);
}

function saveUserToSession(req, user) {
    req.session.user = {
        fullname: user.fullname,
        civilnumber: user.civilnumber,
        avatar: user.avatar,
        status: user.status,
        votingStatus: user.votingStatus
    };
}

// --- API ---
app.get('/api/me', (req, res) => {
    if (req.session.user) {
        res.json({ user: req.session.user });
    } else {
        res.json({ user: null });
    }
});

// Регистрация
app.post('/api/register', (req, res) => {
    const { fullname, civilnumber } = req.body;

    if (!fullname || !civilnumber) {
        return res.status(400).json({ success: false, message: 'Все поля обязательны' });
    }
    if (!isValidFullname(fullname)) {
        return res.status(400).json({ success: false, message: 'ФИО должно содержать минимум два слова, каждое минимум из 3 букв.' });
    }
    if (!isValidCivilnumber(civilnumber)) {
        return res.status(400).json({ success: false, message: 'Гражданский номер должен состоять из 5 цифр.' });
    }
    const existing = db.prepare('SELECT * FROM users WHERE civilnumber = ?').get(civilnumber);
    if (existing) {
        return res.status(400).json({ success: false, message: 'Пользователь уже зарегистрирован' });
    }
    db.prepare(
        'INSERT INTO users (fullname, civilnumber, avatar, status, votingStatus) VALUES (?, ?, ?, ?, ?)'
    ).run(fullname, civilnumber, null, 'pending', null);

    const user = { fullname, civilnumber, status: 'pending', votingStatus: null, avatar: null };
    saveUserToSession(req, user);

    res.json({ success: true, message: 'Регистрация прошла успешно', user });
});

// Обновление аватара
app.post('/api/update-avatar', (req, res) => {
    const user = req.session.user;
    const { avatar } = req.body;
    if (!user) return res.status(401).json({ success: false, message: 'Нет авторизации' });
    db.prepare('UPDATE users SET avatar = ? WHERE civilnumber = ?').run(avatar, user.civilnumber);

    // Обновляем в сессии
    user.avatar = avatar;
    req.session.user = user;

    res.json({ success: true, message: 'Аватарка обновлена', user });
});

// Получить статус пользователя
app.get('/api/user-status/:civilnumber', (req, res) => {
    const { civilnumber } = req.params;
    const user = db.prepare('SELECT * FROM users WHERE civilnumber = ?').get(civilnumber);

    if (!user) {
        return res.status(404).json({ success: false, message: 'Пользователь не найден' });
    }
    // Если это тот же пользователь, обновляем в сессии статус и голосование
    if (req.session.user && req.session.user.civilnumber === civilnumber) {
        req.session.user.status = user.status;
        req.session.user.votingStatus = user.votingStatus;
    }

    res.json({ success: true, status: user.status, votingStatus: user.votingStatus });
});

// Голосование
app.post('/api/vote', (req, res) => {
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

    // обновляем статус в сессии
    req.session.user.votingStatus = 'vote';

    res.json({ success: true, message: 'Голос принят' });
});

// Удаление одного пользователя
app.delete('/api/user/:civilnumber', (req, res) => {
    const { civilnumber } = req.params;
    const user = db.prepare('SELECT * FROM users WHERE civilnumber = ?').get(civilnumber);
    if (!user) {
        return res.status(404).json({ success: false, message: 'Пользователь не найден' });
    }
    db.prepare('DELETE FROM users WHERE civilnumber = ?').run(civilnumber);

    // Если текущий пользователь удалён — чистим сессию
    if (req.session.user && req.session.user.civilnumber === civilnumber) {
        req.session.destroy(() => {});
    }
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
    db.prepare('UPDATE users SET votingStatus = ? WHERE civilnumber = ?').run('vote', civilnumber);

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
        if (user.votingStatus === 'vote') {
            db.prepare('UPDATE users SET votingStatus = ? WHERE civilnumber = ?').run('novote', user.civilnumber);
            updatedCount++;
        }
    });

    console.log(`Сброшено статусов голосования у ${updatedCount} пользователей.`);
    res.json({ success: true, message: `Статусы голосования сброшены у ${updatedCount} пользователей.` });
});

const issuedAdminTokens = new Set();
// Проверка пароля администратора
app.post('/api/admin-login', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    const token = crypto.randomBytes(24).toString('hex');
    issuedAdminTokens.add(token);
    return res.json({ success: true, token });
  }
  return res.status(403).json({ success: false, message: 'Неверный пароль' });
});

// Проверка статуса авторизации администратора
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
      <button onclick="deleteAllUsers()">Удалить всех пользователей (включая localStorage)</button>
      <button onclick="simplifyCheck()">Запретить переход на vote.html</button>
      <button onclick="restoreCheck()">Разрешить переход на vote.html</button>

      <h3>Удаление пользователя по Civil Number</h3>
      <input type="text" id="civilInput" placeholder="Введите гражданский номер">
      <button onclick="deleteUserByCivilnumber()">Удалить пользователя</button>
    `);
  }
  return res.status(403).send('Нет доступа');
});

app.post('/api/simplify-check', (req, res) => {
  try {
    let content = fs.readFileSync(MAIN_JS_PATH, 'utf-8');

    // Заменяем блок с проверкой
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

app.post('/api/restore-check', (req, res) => {
  try {
    let content = fs.readFileSync(MAIN_JS_PATH, 'utf-8');

    // Восстанавливаем оригинальный блок
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

// 404
app.use((req, res) => {
    const errorCode = 404;
    const errorMessage = encodeURIComponent('Страница не найдена');
    res.redirect(`/error.html?code=${errorCode}&message=${errorMessage}`);
});

// 500
app.use((err, req, res, next) => {
    console.error(err.stack);
    const errorCode = 500;
    const errorMessage = encodeURIComponent('Внутренняя ошибка сервера');
    res.redirect(`/error.html?code=${errorCode}&message=${errorMessage}`);
});

app.listen(port, () => {
    console.log(`Сервер запущен на http://localhost:${port}`);
});