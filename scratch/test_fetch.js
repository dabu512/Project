const http = require('http');

function get(url) {
    return new Promise((resolve, reject) => {
        http.get(url, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                resolve({
                    statusCode: res.statusCode,
                    headers: res.headers,
                    body: data
                });
            });
        }).on('error', (err) => {
            reject(err);
        });
    });
}

async function main() {
    try {
        console.log("=== TESTING LOCAL MAP API LOAD ===");
        
        // 1. Check home page
        console.log("1. Fetching http://localhost:3000/...");
        const homeRes = await get("http://localhost:3000/");
        console.log(`   - Status Code: ${homeRes.statusCode}`);
        console.log(`   - Headers:`, homeRes.headers['content-type']);
        
        // 2. Fetching units without versionId
        console.log("\n2. Fetching http://localhost:3000/api/units...");
        const unitsEmpty = await get("http://localhost:3000/api/units");
        console.log(`   - Status Code: ${unitsEmpty.statusCode}`);
        console.log(`   - Body (short):`, unitsEmpty.body.substring(0, 100));

        // 3. Fetching units with a valid versionId (versionId = 3)
        console.log("\n3. Fetching http://localhost:3000/api/units?versionId=3...");
        const unitsRes = await get("http://localhost:3000/api/units?versionId=3");
        console.log(`   - Status Code: ${unitsRes.statusCode}`);
        if (unitsRes.statusCode !== 200) {
            console.log(`   - Error Body:`, unitsRes.body);
        } else {
            const parsed = JSON.parse(unitsRes.body);
            console.log(`   - Success! Features count: ${parsed.features ? parsed.features.length : 'undefined'}`);
        }

    } catch (e) {
        console.error("HTTP REQUEST FAILED:", e.message);
    }
}

main();
