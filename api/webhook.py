from flask import Flask, request, jsonify
import requests
import base64

app = Flask(__name__)

BOT_TOKEN = "8276565608:AAFmS6lGEcIeGoAvd1alktJmihZbzQmYBt0"
TELEGRAM_API = f"https://api.telegram.org/bot{BOT_TOKEN}"
KINOPOISK_API_KEY = base64.b64decode('MGZmM2QzNTUtZjFkNS00MmMyLWJiMDYtZGY0ODJlZTViNjVi').decode('utf-8')

@app.route('/api/webhook', methods=['POST'])
def webhook():
    update = request.get_json()
    
    if "message" in update:
        chat_id = update["message"]["chat"]["id"]
        text = update["message"].get("text", "")
        
        if text == "/start":
            send_message(chat_id, "🎬 Привет! Я KinoPlayer Bot!\nИспользуй /help для помощи")
        elif text == "/help":
            send_message(chat_id, "📝 Напиши название фильма для поиска")
        else:
            # Поиск фильма
            search_films(chat_id, text)
    
    return jsonify({"ok": True}), 200

def send_message(chat_id, text):
    url = f"{TELEGRAM_API}/sendMessage"
    data = {"chat_id": chat_id, "text": text}
    requests.post(url, json=data)

def search_films(chat_id, query):
    try:
        response = requests.get(
            "https://kinopoiskapiunofficial.tech/api/v2.1/films/search-by-keyword",
            headers={"X-API-KEY": KINOPOISK_API_KEY},
            params={"keyword": query}
        )
        films = response.json().get('films', [])[:5]
        
        if films:
            text = f"🔍 Найдено фильмов: {len(films)}\n\n"
            for film in films:
                title = film.get('nameRu') or film.get('nameEn', 'Без названия')
                year = film.get('year', 'Н/Д')
                rating = film.get('rating', 'Н/Д')
                text += f"🎬 {title} ({year})\n⭐ {rating}\n\n"
            send_message(chat_id, text)
        else:
            send_message(chat_id, "❌ Ничего не найдено")
    except Exception as e:
        send_message(chat_id, f"❌ Ошибка: {e}")

if __name__ == '__main__':
    app.run()
