// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 mmBesar
//
// Self-signed servers. The system web view refuses a certificate it does not know, and gives the
// app no way to say "I trust this one". So the app runs a tiny bridge on 127.0.0.1: the web app
// talks plain HTTP/WebSocket to the bridge, and the bridge speaks TLS to the real server and
// accepts exactly ONE certificate - the one whose SHA-256 fingerprint the user chose to trust.
// (Everything is just bytes to the bridge, so HTTP, uploads and live editing all work.)

use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::crypto::{ring as provider, verify_tls12_signature, verify_tls13_signature, CryptoProvider};
use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use rustls::{ClientConfig, Error as TlsError, SignatureScheme};
use sha2::{Digest, Sha256};
use tokio::io::copy_bidirectional;
use tokio::net::{TcpListener, TcpStream};
use tokio::time::timeout;
use tokio_rustls::TlsConnector;

const WAIT: Duration = Duration::from_secs(8);

pub fn fingerprint(der: &[u8]) -> String {
    Sha256::digest(der).iter().map(|b| format!("{b:02X}")).collect::<Vec<_>>().join(":")
}

/// Accepts the one certificate with the pinned fingerprint. With an empty pin it accepts anything
/// and remembers what it saw (that is how a certificate is looked at before the user trusts it).
#[derive(Debug)]
struct Pinned {
    pin: String,
    seen: Mutex<Option<String>>,
    algs: rustls::crypto::WebPkiSupportedAlgorithms,
}

impl ServerCertVerifier for Pinned {
    fn verify_server_cert(&self, end_entity: &CertificateDer<'_>, _i: &[CertificateDer<'_>], _n: &ServerName<'_>, _o: &[u8], _t: UnixTime) -> Result<ServerCertVerified, TlsError> {
        let fp = fingerprint(end_entity.as_ref());
        *self.seen.lock().unwrap() = Some(fp.clone());
        if self.pin.is_empty() || self.pin.eq_ignore_ascii_case(&fp) {
            Ok(ServerCertVerified::assertion())
        } else {
            Err(TlsError::General("the server's certificate is not the one you trusted".into()))
        }
    }
    fn verify_tls12_signature(&self, m: &[u8], c: &CertificateDer<'_>, d: &rustls::DigitallySignedStruct) -> Result<HandshakeSignatureValid, TlsError> {
        verify_tls12_signature(m, c, d, &self.algs)
    }
    fn verify_tls13_signature(&self, m: &[u8], c: &CertificateDer<'_>, d: &rustls::DigitallySignedStruct) -> Result<HandshakeSignatureValid, TlsError> {
        verify_tls13_signature(m, c, d, &self.algs)
    }
    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.algs.supported_schemes()
    }
}

fn connector(pin: &str) -> (TlsConnector, Arc<Pinned>) {
    let prov: Arc<CryptoProvider> = Arc::new(provider::default_provider());
    let v = Arc::new(Pinned { pin: pin.to_string(), seen: Mutex::new(None), algs: prov.signature_verification_algorithms });
    let cfg = ClientConfig::builder_with_provider(prov)
        .with_safe_default_protocol_versions()
        .expect("protocol versions")
        .dangerous()
        .with_custom_certificate_verifier(v.clone())
        .with_no_client_auth();
    (TlsConnector::from(Arc::new(cfg)), v)
}

/// Normal https: the certificate must be signed by a well-known authority.
fn roots_connector() -> TlsConnector {
    let prov: Arc<CryptoProvider> = Arc::new(provider::default_provider());
    let mut store = rustls::RootCertStore::empty();
    store.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    let cfg = ClientConfig::builder_with_provider(prov)
        .with_safe_default_protocol_versions()
        .expect("protocol versions")
        .with_root_certificates(store)
        .with_no_client_auth();
    TlsConnector::from(Arc::new(cfg))
}

/// How the bridge talks to the real server.
#[derive(Clone, Debug)]
pub enum Mode {
    /// http:// (no encryption)
    Plain,
    /// https:// with a certificate from a well-known authority
    Roots,
    /// https:// with a self-signed certificate: only the one with this fingerprint
    Pin(String),
}

fn server_name(host: &str) -> Result<ServerName<'static>, String> {
    ServerName::try_from(host.to_string()).map_err(|e| e.to_string())
}

/// Look at the certificate a server presents (no trust involved). Returns its SHA-256 fingerprint.
pub async fn probe(host: &str, port: u16) -> Result<String, String> {
    let (tls, seen) = connector("");
    let tcp = timeout(WAIT, TcpStream::connect((host, port))).await.map_err(|_| "timed out connecting".to_string())?.map_err(|e| e.to_string())?;
    let _ = timeout(WAIT, tls.connect(server_name(host)?, tcp)).await.map_err(|_| "timed out in the TLS handshake (is this an https:// port?)".to_string())?.map_err(|e| e.to_string())?;
    let fp = seen.seen.lock().unwrap().clone();
    fp.ok_or_else(|| "the server did not show a certificate".to_string())
}

fn running() -> &'static Mutex<HashMap<String, u16>> {
    static R: OnceLock<Mutex<HashMap<String, u16>>> = OnceLock::new();
    R.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Try to reach the server the way the bridge would, and say what went wrong in plain words.
pub async fn check(host: &str, port: u16, mode: &Mode) -> Result<(), String> {
    let tcp = timeout(WAIT, TcpStream::connect((host, port)))
        .await
        .map_err(|_| format!("{host}:{port} did not answer (timed out) - wrong address, or the server is off or unreachable"))?
        .map_err(|e| format!("could not connect to {host}:{port}: {e}"))?;
    let tls = match mode {
        Mode::Plain => return Ok(()),
        Mode::Roots => roots_connector(),
        Mode::Pin(p) => connector(p).0,
    };
    timeout(WAIT, tls.connect(server_name(host)?, tcp))
        .await
        .map_err(|_| "timed out in the TLS handshake - is this an https:// port?".to_string())?
        .map_err(|e| format!("secure connection failed: {e}"))?;
    Ok(())
}

/// Start (or reuse) the bridge for `host:port`. Returns the local port.
pub async fn start(host: String, port: u16, mode: Mode) -> Result<u16, String> {
    let key = format!("{host}:{port}|{mode:?}");
    if let Some(p) = running().lock().unwrap().get(&key) {
        return Ok(*p);
    }
    let listener = TcpListener::bind(("127.0.0.1", 0)).await.map_err(|e| e.to_string())?;
    let local = listener.local_addr().map_err(|e| e.to_string())?.port();
    let tls = match &mode {
        Mode::Plain => None,
        Mode::Roots => Some(roots_connector()),
        Mode::Pin(p) => Some(connector(p).0),
    };
    let name = if tls.is_some() { Some(server_name(&host)?) } else { None };
    running().lock().unwrap().insert(key, local);
    tokio::spawn(async move {
        loop {
            let Ok((mut inbound, _)) = listener.accept().await else { continue };
            let tls = tls.clone();
            let name = name.clone();
            let host = host.clone();
            tokio::spawn(async move {
                let Ok(Ok(out)) = timeout(WAIT, TcpStream::connect((host.as_str(), port))).await else { return };
                let _ = out.set_nodelay(true);
                match (tls, name) {
                    (Some(tls), Some(name)) => {
                        let Ok(Ok(mut out)) = timeout(WAIT, tls.connect(name, out)).await else { return };
                        let _ = copy_bidirectional(&mut inbound, &mut out).await;
                    }
                    _ => {
                        let mut out = out;
                        let _ = copy_bidirectional(&mut inbound, &mut out).await;
                    }
                }
            });
        }
    });
    Ok(local)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    async fn tls_server() -> (u16, String) {
        let key = rcgen::generate_simple_self_signed(vec!["localhost".to_string()]).unwrap();
        let der = key.cert.der().to_vec();
        let fp = fingerprint(&der);
        let cfg = rustls::ServerConfig::builder_with_provider(Arc::new(provider::default_provider()))
            .with_safe_default_protocol_versions()
            .unwrap()
            .with_no_client_auth()
            .with_single_cert(vec![CertificateDer::from(der)], rustls::pki_types::PrivateKeyDer::try_from(key.key_pair.serialize_der()).unwrap())
            .unwrap();
        let acc = tokio_rustls::TlsAcceptor::from(Arc::new(cfg));
        let l = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = l.local_addr().unwrap().port();
        tokio::spawn(async move {
            loop {
                let (s, _) = l.accept().await.unwrap();
                let acc = acc.clone();
                tokio::spawn(async move {
                    if let Ok(mut t) = acc.accept(s).await {
                        let mut b = [0u8; 4];
                        if t.read_exact(&mut b).await.is_ok() && &b == b"ping" {
                            let _ = t.write_all(b"pong").await;
                            let _ = t.shutdown().await;
                        }
                    }
                });
            }
        });
        (port, fp)
    }

    #[tokio::test]
    async fn probe_then_bridge_with_the_right_pin() {
        let (port, fp) = tls_server().await;
        assert_eq!(probe("localhost", port).await.unwrap(), fp);
        let local = start("localhost".into(), port, Mode::Pin(fp)).await.unwrap();
        let mut c = TcpStream::connect(("127.0.0.1", local)).await.unwrap();
        c.write_all(b"ping").await.unwrap();
        let mut got = Vec::new();
        c.read_to_end(&mut got).await.unwrap();
        assert_eq!(got, b"pong");
    }

    #[tokio::test]
    async fn a_different_certificate_is_refused() {
        let (port, _fp) = tls_server().await;
        let local = start("localhost".into(), port, Mode::Pin("00:11".into())).await.unwrap();
        let mut c = TcpStream::connect(("127.0.0.1", local)).await.unwrap();
        let _ = c.write_all(b"ping").await;
        let mut got = Vec::new();
        let _ = c.read_to_end(&mut got).await;
        assert!(got.is_empty(), "nothing may come through for an untrusted certificate");
    }

    #[tokio::test]
    async fn plain_http_goes_through_and_diagnostics_speak() {
        let l = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = l.local_addr().unwrap().port();
        tokio::spawn(async move {
            loop {
                let (mut s, _) = l.accept().await.unwrap();
                tokio::spawn(async move {
                    let mut b = [0u8; 4];
                    if s.read_exact(&mut b).await.is_ok() {
                        let _ = s.write_all(b"pong").await;
                    }
                });
            }
        });
        assert!(check("127.0.0.1", port, &Mode::Plain).await.is_ok());
        let local = start("127.0.0.1".into(), port, Mode::Plain).await.unwrap();
        let mut c = TcpStream::connect(("127.0.0.1", local)).await.unwrap();
        c.write_all(b"ping").await.unwrap();
        let mut got = [0u8; 4];
        c.read_exact(&mut got).await.unwrap();
        assert_eq!(&got, b"pong");
        // nothing listens on port 1: a readable reason, not a hang
        let e = check("127.0.0.1", 1, &Mode::Plain).await.unwrap_err();
        assert!(e.contains("could not connect"), "{e}");
    }

    #[tokio::test]
    async fn a_self_signed_certificate_fails_the_normal_check_but_passes_when_pinned() {
        let (port, fp) = tls_server().await;
        assert!(check("localhost", port, &Mode::Roots).await.is_err());
        assert!(check("localhost", port, &Mode::Pin(fp)).await.is_ok());
    }
}
