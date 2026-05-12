async function check() {
    try {
        const res = await fetch('http://127.0.0.1:3000/my-animals', { redirect: 'manual' });
        console.log('STATUS:', res.status, res.statusText);
        console.log('HEADERS:', Object.fromEntries(res.headers.entries()));
        const text = await res.text();
        console.log('LENGTH:', text.length);
        if (text.includes('next-auth')) console.log('Contains next-auth');
        if (res.status === 500) console.log('BODY:', text.substring(0, 1000));
    } catch(e) { console.error('Er', e.message); }
}

check();
