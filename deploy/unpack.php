<?php

/*
 * One-shot release unpacker, uploaded by GitHub Actions next to release.zip.
 *
 * FTP uploads of thousands of small files are slow and Bluehost's FTPS drops
 * the connection part way, so CI uploads one zip and calls this script to
 * extract it. The script only accepts the random key generated for this run
 * (its SHA-256 is written below by CI), then deletes itself and the zip.
 */

const KEY_HASH = '__KEY_HASH__';

header('Content-Type: application/json');
header('Cache-Control: no-store');

function done(int $code, array $body): never
{
    http_response_code($code);
    echo json_encode($body);
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    done(405, ['message' => 'POST only.']);
}

$key = (string) ($_SERVER['HTTP_X_DEPLOY_KEY'] ?? '');
if (KEY_HASH === '__KEY' . '_HASH__' || ! hash_equals(KEY_HASH, hash('sha256', $key))) {
    done(403, ['message' => 'Wrong key.']);
}

$base = dirname(__DIR__);
$zipPath = $base.'/release.zip';

if (! class_exists(ZipArchive::class)) {
    done(500, ['message' => 'The PHP zip extension is not enabled. Turn it on in cPanel → Select PHP Version → Extensions.']);
}
if (! is_file($zipPath)) {
    done(404, ['message' => 'release.zip was not found.']);
}

@set_time_limit(300);
$zip = new ZipArchive();
if ($zip->open($zipPath) !== true) {
    done(500, ['message' => 'release.zip could not be opened (incomplete upload?).']);
}

$count = $zip->numFiles;
$ok = $zip->extractTo($base);
$zip->close();

@unlink($zipPath);
@unlink(__FILE__);

if (function_exists('opcache_reset')) {
    @opcache_reset();
}

if (! $ok) {
    done(500, ['message' => 'Extraction failed. Check that the site folder is writable.']);
}

done(200, ['message' => "Unpacked {$count} files.", 'files' => $count]);
