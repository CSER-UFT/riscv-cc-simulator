import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import pt from '../js/i18n/pt.js';
import en from '../js/i18n/en.js';
import helpPt from '../js/help/pt.js';
import helpEn from '../js/help/en.js';

test('pt e en têm as mesmas chaves', () => {
    assert.deepEqual(Object.keys(en).sort(), Object.keys(pt).sort());
    assert.deepEqual(helpEn.sections.map((s) => s.id), helpPt.sections.map((s) => s.id));
});

test('toda chave usada no código existe', () => {
    const files = ['js/app.js', ...readdirSync('js/cc').map((f) => `js/cc/${f}`), ...readdirSync('js/ui').map((f) => `js/ui/${f}`), 'index.html'];
    const used = new Set();
    for (const f of files) {
        const src = readFileSync(f, 'utf8');
        for (const m of src.matchAll(/(?:\bt|\btr|fail|err)\(\s*'([a-z][\w.]*)'/g)) used.add(m[1]);
        for (const m of src.matchAll(/data-i18n(?:-html|-title)?="([\w.]+)"/g)) used.add(m[1]);
    }
    const missing = [...used].filter((k) => k.includes('.') && !(k in pt));
    assert.deepEqual(missing, []);
});
