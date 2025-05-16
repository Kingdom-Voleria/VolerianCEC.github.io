document.addEventListener('DOMContentLoaded', async function () {
    const currentPage = window.location.pathname.split('/').pop();

    // Функция получения текущего пользователя по cookie
    async function getCurrentUser() {
        const res = await fetch('http://localhost:3000/api/me', { credentials: 'include' });
        if (res.ok) {
            const data = await res.json();
            return data.user || null;
        }
        return null;
    }

    let user = await getCurrentUser();

    // --- Анимация появления секций на главной странице ---
    const sections = document.querySelectorAll('.content-section');
    function checkVisibility() {
        sections.forEach(section => {
            const rect = section.getBoundingClientRect();
            const isVisible = rect.top <= window.innerHeight * 0.8 && rect.bottom >= window.innerHeight * 0.2;
            if (isVisible) section.classList.add('visible');
        });
    }
    checkVisibility();
    window.addEventListener('scroll', checkVisibility);

    // --- Плавный скролл к разделам регистрации и голосования ---
    document.querySelectorAll('.action-button').forEach(button => {
        button.addEventListener('click', function (e) {
            const targetId = this.getAttribute('href');
            if (targetId === '#register' || targetId === '#vote') {
                e.preventDefault();
                const targetElement = document.querySelector(targetId);
                if (targetElement) {
                    const offset = targetElement.getBoundingClientRect().top + window.pageYOffset - 80;
                    window.scrollTo({ top: offset, behavior: 'smooth' });
                }
            }
        });
    });

    // --- Анимация блоков на странице выборов ---
    const electionBlocks = document.querySelectorAll('.selection-block, .title-active, .title-inactive');
    electionBlocks.forEach(block => {
        block.style.opacity = '0';
        block.style.transform = 'translateY(20px)';
        block.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
    });
    function checkElectionVisibility() {
        electionBlocks.forEach(block => {
            const rect = block.getBoundingClientRect();
            const isVisible = rect.top <= window.innerHeight * 0.8 && rect.bottom >= window.innerHeight * 0.2;
            if (isVisible) {
                block.style.opacity = '1';
                block.style.transform = 'translateY(0)';
            }
        });
    }
    checkElectionVisibility();
    window.addEventListener('scroll', checkElectionVisibility);

    // --- Показ блока профиля вместо формы регистрации ---
    function setupProfileAvatar() {
        if (!user || user.status !== 'approved') return;
        const navLinks = document.querySelector('.header-links');
        if (!navLinks) return;

        const profileLink = [...navLinks.children].find(link => link.textContent.trim() === 'Регистрация');
        if (!profileLink) return;

        const avatarWrapper = document.createElement('div');
        avatarWrapper.className = 'avatar-wrapper';
        avatarWrapper.style.cursor = 'pointer';

        const avatarImg = document.createElement('img');
        avatarImg.src = user.avatar || 'image/profile-empty.png';
        avatarImg.alt = 'Аватар';
        avatarImg.className = 'header-avatar';

        const nameParts = user.fullname.trim().split(/\s+/);
        const userNameSpan = document.createElement('span');
        userNameSpan.textContent = nameParts[1] || nameParts[0];
        userNameSpan.className = 'avatar-name';

        avatarWrapper.append(avatarImg, userNameSpan);
        avatarWrapper.addEventListener('click', () => window.location.href = 'profile.html');

        profileLink.replaceWith(avatarWrapper);
    }
    setupProfileAvatar();

    // === Профиль ===
    if (currentPage === 'profile.html') {
        if (!user) {
            window.location.href = 'registration.html';
            return;
        }

        const header = document.querySelector('header');
        if (header) {
            Object.assign(header.style, {
                position: 'fixed',
                top: '0',
                left: '0',
                width: '100%',
                zIndex: '1000',
            });
        }

        const profileCard = document.getElementById('profile-card');
        if (!profileCard) return;

        // Обновляем статус с сервера и обновляем интерфейс
        fetch(`http://localhost:3000/api/user-status/${user.civilnumber}`, { credentials: 'include' })
            .then(res => res.json())
            .then(async data => {
                if (data.success) {
                    user.status = data.status;
                    user.votingStatus = data.votingStatus;
                    // если статус изменился, обновим local user и перерисуем страницу
                    if (user.status !== 'approved') {
                        user = await getCurrentUser();
                        window.location.reload();
                    }
                }
            });

        if (user.status === 'pending' || user.status === 'rejected') {
            profileCard.style.display = 'none';

            const messages = {
                pending: `
                    <p>Ваш профиль находится на проверке. Пожалуйста, обратитесь в сообщество граждан Волерии в социальной сети ВКонтакте, чтобы подтвердить заявку.</p>
                    <div class="action-buttons-wrapper">
                        <div class="action-buttons">
                            <a href="https://vk.com/citizens_volerian" class="action-button">Сообщество ВКонтакте</a>
                        </div>
                    </div>
                `,
                rejected: `
                    <b style="color: #dc3545;">Ваш запрос на регистрацию профиля был отменён. Пожалуйста, подайте заявку заново или, если вы не согласны с решением, обратитесь к администрации сайта через личные сообщения в сообществе граждан Волерии в социальной сети ВКонтакте.</b>
                    <div class="action-buttons-wrapper" style="justify-content: space-between;">
                        <div class="action-buttons">
                            <a class="action-button" id="resubmit-button">Подать заявку заново</a>
                        </div>
                        <div class="action-buttons">
                            <a href="https://vk.com/citizens_volerian" class="action-button">Сообщество ВКонтакте</a>
                        </div>
                    </div>
                `
            };

            const container = document.createElement('div');
            container.className = 'message';
            container.innerHTML = messages[user.status];
            document.body.appendChild(container);

            if (user.status === 'rejected') {
                document.getElementById('resubmit-button').addEventListener('click', async () => {
                    await fetch(`http://localhost:3000/api/user/${user.civilnumber}`, { method: 'DELETE', credentials: 'include' });
                    document.cookie = 'session=; Max-Age=0; path=/;';
                    window.location.href = 'registration.html';
                });
            }
            return;
        }

        if (user.status === 'approved') {
            profileCard.style.display = 'block';
            requestAnimationFrame(() => profileCard.classList.add('visible'));

            const fullnameElement = document.getElementById('userFullname');
            const civilnumberElement = document.getElementById('userCivilnumber');
            const avatarPreview = document.getElementById('avatarPreview');
            const avatarInput = document.getElementById('avatarInput');

            if (fullnameElement && civilnumberElement && avatarPreview) {
                fullnameElement.textContent = user.fullname;
                civilnumberElement.textContent = user.civilnumber;
                avatarPreview.src = user.avatar || 'image/profile-empty.png';

                avatarInput?.addEventListener('change', function () {
                    const file = avatarInput.files[0];
                    const reader = new FileReader();
                    reader.onloadend = async function () {
                        const avatar = reader.result;
                        const res = await fetch('http://localhost:3000/api/update-avatar', {
                            method: 'POST',
                            credentials: 'include',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ avatar })
                        });
                        if (res.ok) {
                            avatarPreview.src = avatar;
                            user.avatar = avatar;
                        }
                    };
                    reader.readAsDataURL(file);
                });
            }
        }
    }

    // === Регистрация ===
    if (currentPage === 'registration.html') {
        if (user) {
            window.location.href = 'profile.html';
            return;
        }

        const registerForm = document.querySelector('.register-form');
        if (registerForm) {
            registerForm.addEventListener('submit', async function (e) {
                e.preventDefault();
                const fullname = document.getElementById('fullname').value.trim();
                const civilnumber = document.getElementById('civilnumber').value.trim();

                if (!/^[A-Za-zА-Яа-я]{3,}(?:\s+[A-Za-zА-Яа-я]{3,})+$/.test(fullname)) {
                    return showError('ФИО должно содержать минимум два слова, каждое минимум из 3 букв.');
                }
                if (!/^\d{5}$/.test(civilnumber)) {
                    return showError('Гражданский номер должен состоять из 5 цифр.');
                }

                try {
                    const res = await fetch('http://localhost:3000/api/register', {
                        method: 'POST',
                        credentials: 'include',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ fullname, civilnumber })
                    });
                    const data = await res.json();
                    if (data.success) {
                        window.location.href = 'profile.html';
                    } else {
                        showError(data.message || 'Ошибка регистрации');
                    }
                } catch {
                    showError('Не удалось подключиться к серверу.');
                }
            });
        }

        function showError(message) {
            document.querySelector('.error-message')?.remove();
            const errorBox = document.createElement('div');
            errorBox.className = 'error-message';
            errorBox.textContent = message;
            Object.assign(errorBox.style, {
                backgroundColor: '#ffe5e5',
                color: '#cc0000',
                padding: '10px',
                borderRadius: '8px',
                marginTop: '12px',
                fontSize: '14px',
                textAlign: 'center',
            });
            registerForm.insertAdjacentElement('afterend', errorBox);
            setTimeout(() => errorBox.remove(), 5000);
        }
    }

    // Анимация формы регистрации
    const form = document.querySelector(".registration-form");
    if (form) {
        requestAnimationFrame(() => {
            form.classList.add("visible");
        });
    }

    // === Голосование ===
    if (currentPage === 'vote.html') {
        if (!user || user.status !== 'approved') {
            window.location.href = 'elections.html';
            return;
        }

        const votingBlock = document.querySelector('.voting-block');
        const votedMessage = document.getElementById('voted-message');
        const form = document.getElementById('voteForm');

        if (user.votingStatus === 'vote') {
            votingBlock?.remove();
            votedMessage?.style.setProperty('display', 'block');
            return;
        }

        fetch(`http://localhost:3000/api/user-status/${user.civilnumber}`, { credentials: 'include' })
            .then(res => res.json())
            .then(data => {
                if (data.votingStatus === 'vote') {
                    votingBlock?.remove();
                    votedMessage?.style.setProperty('display', 'block');
                }
            });

        form?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const selected = document.querySelector('input[name="vote"]:checked');
            if (!selected) {
                const errorBox = document.createElement('div');
                errorBox.className = 'error-message';
                errorBox.textContent = 'Пожалуйста, выберите вариант.';
                votingBlock.insertAdjacentElement('afterend', errorBox);
                setTimeout(() => errorBox.remove(), 5000);
                return;
            }

            const res = await fetch('http://localhost:3000/api/vote', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ option: selected.value })
            });
            const data = await res.json();

            if (data.success) {
                votingBlock?.remove();
                votedMessage?.style.setProperty('display', 'block');
            }
        });
    }

    // Выделение выбранного варианта
    document.querySelectorAll('.vote-option').forEach(option => {
        const radio = option.querySelector('input[type="radio"]');
        if (radio?.checked) option.classList.add('selected');
        option.addEventListener('click', function () {
            document.querySelectorAll('.vote-option').forEach(opt => opt.classList.remove('selected'));
            this.classList.add('selected');
            radio.checked = true;
        });
    });

    // Ограничение перехода по неактивным ссылкам
    const voteLink = document.getElementById('vote-link');
    voteLink?.addEventListener('click', (e) => {
        if (!user || user.status !== 'approved') e.preventDefault();
    });

    document.querySelectorAll('.selection-inactive a').forEach(link =>
        link.addEventListener('click', (e) => e.preventDefault())
    );

    const statusBox = document.querySelector(`.status-${user?.status || 'not-found'}`);
    if (statusBox) statusBox.style.display = 'flex';

    // === error.html ===
    if (currentPage === 'error.html') {
        const params = new URLSearchParams(window.location.search);
        const code = params.get('code') || 'Ошибка';
        const message = params.get('message') || 'Произошла непредвиденная ошибка';

        const codeElem = document.getElementById('error-code');
        const messageElem = document.getElementById('error-message');

        if (codeElem) codeElem.textContent = code;
        if (messageElem) messageElem.textContent = decodeURIComponent(message);
    }

    // Анимация появления на странице ошибки
    const errorContent = document.querySelector(".error-content");
    if (errorContent) {
        requestAnimationFrame(() => {
            errorContent.classList.add("visible");
        });
    }
});