<?php
// proxy.php — положите рядом с index.html на сервере
// Все запросы к API идут через этот файл, CORS не мешает

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET');
header('Access-Control-Allow-Headers: Content-Type');

define('API_KEY',  '3c4f040d3bf84b318fd52b2883b31077');
define('API_BASE', 'https://api.kinopoiskapi.uz/api');

// Берём path из ?path=/v2.2/films/top...
$path = isset($_GET['path']) ? $_GET['path'] : '';

// Безопасность: только /v2.1 и /v2.2 пути
if (!preg_match('#^/v2\.[12]/#', $path)) {
    http_response_code(400);
    echo json_encode(['error' => 'Invalid path']);
    exit;
}

$url = API_BASE . $path;

$ch = curl_init($url);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_TIMEOUT        => 15,
    CURLOPT_HTTPHEADER     => [
        'X-API-KEY: ' . API_KEY,
        'Content-Type: application/json',
        'Accept: application/json',
    ],
    CURLOPT_SSL_VERIFYPEER => true,
    CURLOPT_USERAGENT      => 'Genopoisk/1.0',
]);

$body   = curl_exec($ch);
$status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$error  = curl_error($ch);
curl_close($ch);

if ($error) {
    http_response_code(502);
    echo json_encode(['error' => 'Curl error: ' . $error]);
    exit;
}

http_response_code($status);
echo $body;