# I Want to Feel More Alive

An exercise with the Academy for Teachers, led by Peter Nilsson.

- Participant link: `https://pbnilsson.github.io/most-alive/`
- Host screen: `https://pbnilsson.github.io/most-alive/host.html` (sign in with pbnilsson@gmail.com)

Data lives in Firebase project `most-alive-89fc9` (Firestore). Security rules are in `firestore.rules`.

To rebuild after editing `src/`: `npm install && npx esbuild src/participant.js src/host.js --bundle --format=esm --minify --target=es2020 --outdir=dist`

Local test with simulated participants (no Firebase): serve the folder and open `test/harness.html?n=5`.
