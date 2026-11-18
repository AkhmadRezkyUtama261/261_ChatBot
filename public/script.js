/**
 * PWS ChatBot - script.js
 * Logika interaksi frontend, streaming SSE, dan rendering pesan
 */

document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const chatMessages = document.getElementById('chatMessages');
    const chatForm = document.getElementById('chatForm');
    const userInput = document.getElementById('userInput');
    const sendBtn = document.getElementById('sendBtn');
    const clearBtn = document.getElementById('clearBtn');
    const welcomeCard = document.getElementById('welcomeCard');
    const suggestionChips = document.querySelectorAll('.suggestion-chip');

    // State Percakapan
    let messagesHistory = [];
    let isGenerating = false;

    // SVG Icons
    const BOT_AVATAR_SVG = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="11" width="18" height="10" rx="3"></rect>
            <circle cx="12" cy="5" r="2"></circle>
            <path d="M12 7v4"></path>
            <line x1="8" y1="16" x2="8.01" y2="16"></line>
            <line x1="16" y1="16" x2="16.01" y2="16"></line>
        </svg>
    `;

    const USER_AVATAR_SVG = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
            <circle cx="12" cy="7" r="4"></circle>
        </svg>
    `;

    // Format Jam (HH:mm)
    function getCurrentTime() {
        const now = new Date();
        return now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    // Auto-scroll ke pesan terbawah
    function scrollToBottom() {
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    // Auto-resize textarea sesuai panjang input
    function autoResizeTextarea() {
        userInput.style.height = 'auto';
        userInput.style.height = `${Math.min(userInput.scrollHeight, 120)}px`;
    }

    userInput.addEventListener('input', autoResizeTextarea);

    // Escape HTML untuk mencegah XSS
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Parser Markdown Sederhana (Bold, Code Blocks, Inline Code, Lists, Linebreaks)
    function parseMarkdown(text) {
        if (!text) return '';

        // 1. Simpan dan format code blocks (```lang ... ```)
        const codeBlocks = [];
        let formatted = text.replace(/```([\s\S]*?)```/g, (match, code) => {
            codeBlocks.push(escapeHtml(code.trim()));
            return `__CODE_BLOCK_${codeBlocks.length - 1}__`;
        });

        // 2. Escape teks umum
        formatted = escapeHtml(formatted);

        // 3. Format inline code (`code`)
        formatted = formatted.replace(/`([^`]+)`/g, '<code>$1</code>');

        // 4. Format bold (**teks**)
        formatted = formatted.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

        // 5. Format italic (*teks*)
        formatted = formatted.replace(/\*([^*]+)\*/g, '<em>$1</em>');

        // 6. Format bullet list (- item atau * item)
        formatted = formatted.replace(/^[\*\-]\s+(.*)$/gm, '<li>$1</li>');
        formatted = formatted.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');

        // 7. Ganti newline dengan <br>
        formatted = formatted.replace(/\n/g, '<br>');

        // 8. Kembalikan code blocks yang disimpan
        codeBlocks.forEach((code, index) => {
            const placeholder = `__CODE_BLOCK_${index}__`;
            formatted = formatted.replace(placeholder, `<pre><code>${code}</code></pre>`);
        });

        return formatted;
    }

    // Buat elemen baris pesan
    function createMessageElement(sender, content = '', isError = false) {
        const row = document.createElement('div');
        row.className = `message-row ${sender}${isError ? ' error' : ''}`;

        const avatar = document.createElement('div');
        avatar.className = 'message-avatar';
        avatar.innerHTML = sender === 'bot' ? BOT_AVATAR_SVG : USER_AVATAR_SVG;

        const contentContainer = document.createElement('div');
        contentContainer.className = 'message-content';

        const bubble = document.createElement('div');
        bubble.className = 'message-bubble';

        if (content) {
            bubble.innerHTML = sender === 'bot' ? parseMarkdown(content) : escapeHtml(content).replace(/\n/g, '<br>');
        }

        const time = document.createElement('div');
        time.className = 'message-time';
        time.textContent = getCurrentTime();

        contentContainer.appendChild(bubble);
        contentContainer.appendChild(time);

        row.appendChild(avatar);
        row.appendChild(contentContainer);

        return { row, bubble };
    }

    // Tampilkan indikator mengetik (typing indicator)
    function createTypingIndicator() {
        const indicator = document.createElement('div');
        indicator.className = 'typing-indicator';
        indicator.innerHTML = `
            <div class="typing-dot"></div>
            <div class="typing-dot"></div>
            <div class="typing-dot"></div>
        `;
        return indicator;
    }

    // Kirim pesan ke backend & tangani streaming response
    async function sendMessage(text) {
        const messageText = text.trim();
        if (!messageText || isGenerating) return;

        // Sembunyikan welcome card saat pesan pertama dikirim
        if (welcomeCard && welcomeCard.style.display !== 'none') {
            welcomeCard.style.display = 'none';
        }

        // 1. Tampilkan pesan user ke layar
        const userMsg = createMessageElement('user', messageText);
        chatMessages.appendChild(userMsg.row);
        scrollToBottom();

        // 2. Simpan pesan ke history
        messagesHistory.push({
            role: 'user',
            content: messageText
        });

        // 3. Reset input field
        userInput.value = '';
        userInput.style.height = 'auto';

        // 4. Set state generating
        isGenerating = true;
        sendBtn.disabled = true;
        userInput.disabled = true;

        // 5. Buat bubble respons bot dengan indikator loading
        const botMsg = createMessageElement('bot');
        const typingIndicator = createTypingIndicator();
        botMsg.bubble.appendChild(typingIndicator);
        chatMessages.appendChild(botMsg.row);
        scrollToBottom();

        let botFullResponse = '';

        try {
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    message: messagesHistory
                })
            });

            if (!response.ok) {
                const errorData = await response.text();
                throw new Error(`Server error (${response.status}): ${errorData || 'Gagal memproses pesan'}`);
            }

            // Hapus indikator mengetik setelah streaming mulai terhubung
            typingIndicator.remove();

            // Setup SSE Reader
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            let isFirstChunk = true;

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop(); // Simpan baris yang belum selesai

                for (const line of lines) {
                    const trimmedLine = line.trim();
                    if (!trimmedLine || !trimmedLine.startsWith('data:')) continue;

                    const data = trimmedLine.slice(5).trim();
                    if (data === '[DONE]') continue;

                    try {
                        // Data dikirim backend sebagai JSON.stringify(content)
                        const contentChunk = JSON.parse(data);
                        if (contentChunk) {
                            botFullResponse += contentChunk;
                            botMsg.bubble.innerHTML = parseMarkdown(botFullResponse);
                            scrollToBottom();
                        }
                    } catch (parseErr) {
                        // Jika bukan JSON string, langsung append teksnya
                        botFullResponse += data;
                        botMsg.bubble.innerHTML = parseMarkdown(botFullResponse);
                        scrollToBottom();
                    }
                }
            }

            // Jika respons kosong sama sekali
            if (!botFullResponse) {
                botMsg.bubble.innerHTML = '<em>(Tidak ada respons yang diterima dari server)</em>';
            }

            // Simpan respons bot ke conversation history
            messagesHistory.push({
                role: 'assistant',
                content: botFullResponse
            });

        } catch (error) {
            console.error('Error saat mengirim pesan:', error);
            typingIndicator.remove();
            botMsg.row.classList.add('error');
            botMsg.bubble.innerHTML = `⚠️ <strong>Terjadi Kesalahan:</strong> ${escapeHtml(error.message || 'Tidak dapat terhubung ke server chatbot.')}`;
        } finally {
            isGenerating = false;
            sendBtn.disabled = false;
            userInput.disabled = false;
            userInput.focus();
            scrollToBottom();
        }
    }

    // Submit handler
    chatForm.addEventListener('submit', (e) => {
        e.preventDefault();
        sendMessage(userInput.value);
    });

    // Handle tombol Enter untuk kirim, Shift + Enter untuk new line
    userInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage(userInput.value);
        }
    });

    // Handle suggestion chips
    suggestionChips.forEach((chip) => {
        chip.addEventListener('click', () => {
            const prompt = chip.getAttribute('data-prompt');
            if (prompt) {
                sendMessage(prompt);
            }
        });
    });

    // Handle Bersihkan Percakapan (Clear Chat)
    clearBtn.addEventListener('click', () => {
        if (messagesHistory.length === 0) return;

        const confirmClear = confirm('Apakah Anda yakin ingin menghapus seluruh riwayat percakapan?');
        if (confirmClear) {
            messagesHistory = [];
            chatMessages.innerHTML = '';
            if (welcomeCard) {
                welcomeCard.style.display = 'block';
                chatMessages.appendChild(welcomeCard);
            }
            userInput.value = '';
            userInput.style.height = 'auto';
            userInput.focus();
        }
    });

    // Fokus ke input saat halaman dimuat
    userInput.focus();
});
