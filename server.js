const express = require('express');
const cors = require('cors');
const app = express();
const port = process.env.PORT || 3000;


app.use(cors());
app.use(express.json());

let users = [];
let votes = { option1: 0, option2: 0 };

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

    const existing = users.find(u => u.civilnumber === civilnumber);
    if (existing) {
        return res.status(400).json({ success: false, message: 'Пользователь уже зарегистрирован' });
    }

    const newUser = { fullname, civilnumber, avatar: null, status: 'pending', votingStatus: null };
    users.push(newUser);

    console.log(`Зарегистрирован: ${newUser.fullname}, Гражданский номер: ${newUser.civilnumber}`);
    res.json({ success: true, message: 'Регистрация прошла успешно', user: newUser });
});

// Модерация пользователя
app.post('/api/moderate', (req, res) => {
    const { civilnumber, action } = req.body;
    const user = users.find(u => u.civilnumber === civilnumber);
    if (!user) {
        return res.status(404).json({ success: false, message: 'Пользователь не найден' });
    }

    if (action === 'approve') {
        user.status = 'approved';
        user.votingStatus = 'novote';
        res.json({ success: true, message: 'Пользователь одобрен' });
    } else if (action === 'reject') {
        user.status = 'rejected';
        res.json({ success: true, message: 'Пользователь отклонён' });
    } else {
        res.status(400).json({ success: false, message: 'Неверное действие' });
    }
});

// Получить всех пользователей на проверке
app.get('/api/pending-users', (req, res) => {
    const pendingUsers = users.filter(user => user.status === 'pending');
    res.json({ success: true, users: pendingUsers });
});

// Обновление аватарки
app.post('/api/update-avatar', (req, res) => {
    const { civilnumber, avatar } = req.body;
    const user = users.find(u => u.civilnumber === civilnumber);
    if (!user) {
        return res.status(404).json({ success: false, message: 'Пользователь не найден' });
    }

    user.avatar = avatar;
    console.log(`Аватарка пользователя ${user.fullname} обновлена`);
    res.json({ success: true, message: 'Аватарка обновлена', user });
});

// Список пользователей
app.get('/api/users', (req, res) => {
    console.log('Список зарегистрированных пользователей:');
    users.forEach(user => {
        console.log(`ФИО: ${user.fullname}, Гражданский номер: ${user.civilnumber}, Статус: ${user.status}, Статус Голосования: ${user.votingStatus}`);
    });
    res.json({ success: true, users });
});

// Удаление всех пользователей
app.delete('/api/users', (req, res) => {
    users = [];
    console.log('Все пользователи удалены.');
    res.json({ success: true, message: 'Все пользователи были удалены.' });
});

// Удаление одного пользователя
app.delete('/api/user/:civilnumber', (req, res) => {
    const { civilnumber } = req.params;
    const userIndex = users.findIndex(u => u.civilnumber === civilnumber);

    if (userIndex === -1) {
        return res.status(404).json({ success: false, message: 'Пользователь не найден' });
    }

    const deletedUser = users.splice(userIndex, 1)[0];
    console.log(`Пользователь ${deletedUser.fullname} (Гражданский номер: ${deletedUser.civilnumber}) удалён.`);
    res.json({ success: true, message: 'Пользователь успешно удалён', user: deletedUser });
});

// Получить всю информацию о пользователе
app.get('/api/user-info/:civilnumber', (req, res) => {
    const { civilnumber } = req.params;
    const user = users.find(u => u.civilnumber === civilnumber);

    if (!user) {
        return res.status(404).json({ success: false, message: 'Пользователь не найден' });
    }

    res.json({
        success: true,
        user: {
            fullname: user.fullname,
            civilnumber: user.civilnumber,
            status: user.status,
            votingStatus: user.votingStatus
        }
    });
});

// Получить статус пользователя
app.get('/api/user-status/:civilnumber', (req, res) => {
    const { civilnumber } = req.params;
    const user = users.find(u => u.civilnumber === civilnumber);

    if (!user) {
        return res.status(404).json({ success: false, message: 'Пользователь не найден' });
    }

    res.json({
        success: true,
        status: user.status,
        votingStatus: user.votingStatus
    });
});

// Голосование
app.post('/api/vote', (req, res) => {
    console.log('Получен запрос на голосование:', req.body);

    const { civilnumber, option } = req.body;
    const user = users.find(u => u.civilnumber === civilnumber);

    if (!user) {
        return res.status(404).json({ success: false, message: 'Пользователь не найден' });
    }

    if (user.status !== 'approved') {
        return res.status(403).json({ success: false, message: 'Пользователь не одобрен для голосования' });
    }

    if (user.votingStatus !== 'novote') {
        return res.status(400).json({ success: false, message: 'Вы уже голосовали' });
    }

    if (!votes.hasOwnProperty(option)) {
        return res.status(400).json({ success: false, message: 'Неверный вариант голосования' });
    }

    votes[option]++;
    user.votingStatus = 'voted';

    console.log(`${user.fullname} проголосовал за ${option}`);
    res.json({ success: true, message: 'Голос принят' });
});

// Получить результаты голосования
app.get('/api/votes', (req, res) => {
    res.json({ success: true, votes });
});

// Удаление всех результатов голосования
app.delete('/api/votes', (req, res) => {
    votes = { option1: 0, option2: 0 };
    console.log('Все результаты голосования обнулены.');
    res.json({ success: true, message: 'Все результаты голосования были удалены.' });
});

// Запуск сервера
app.listen(port, () => {
    console.log(`Сервер запущен на http://localhost:${port}`);
});