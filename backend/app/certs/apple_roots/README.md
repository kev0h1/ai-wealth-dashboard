# Pinned Apple root certificates (C21)

Place Apple's root certificate here, as a `.cer`, `.der`, `.crt` or `.pem` file,
before enabling in-app purchase (`APPLE_IAP_ENABLED`). Every certificate in this
directory is trusted as an anchor for App Store Server Notifications V2 and
signed transactions, so put nothing here that you do not mean to trust.

Source: Apple's certificate authority page,
https://www.apple.com/certificateauthority/ ("Apple Root CA - G3"). Check the
SHA-256 fingerprint of the downloaded file against that page before committing
it. This repository's code never fetches it: verification needs no network.

Until a root is present the receiver answers 503 and nothing is granted.
The directory can be moved with `APPLE_ROOT_CERTS_DIR`.
