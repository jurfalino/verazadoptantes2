const http = require('http');

async function testRedirect() {
    try {
        const res = await fetch('http://127.0.0.1:3000/my-animals', { redirect: 'manual' });
        console.log('STATUS:', res.status, res.statusText);
        console.log('LOCATION:', res.headers.get('location'));
    } catch(e) { console.error('Er', e.message); }
}

testRedirect();
