use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;

use hickory_resolver::config::{NameServerConfigGroup, ResolverConfig, ResolverOpts};
use hickory_resolver::TokioAsyncResolver;
use reqwest::dns::{Addrs, Name, Resolve, Resolving};

// Sur certains postes (réseau d'entreprise), le DNS configuré au niveau de
// Windows ne parvient pas à résoudre certains domaines externes (mauvaise
// configuration réseau, DNS filtrant, etc.), alors que les navigateurs
// fonctionnent quand même grâce à leur propre résolution DNS sécurisée.
// On reproduit ce comportement ici : les requêtes WooCommerce passent par un
// résolveur DNS public (Cloudflare + Google) au lieu du résolveur système,
// indépendamment de ce qui est cassé sur la machine.
#[derive(Clone)]
struct DnsPublic(Arc<TokioAsyncResolver>);

impl DnsPublic {
    fn new() -> Self {
        let mut serveurs = NameServerConfigGroup::cloudflare();
        serveurs.merge(NameServerConfigGroup::google());
        let config = ResolverConfig::from_parts(None, vec![], serveurs);
        let resolver = TokioAsyncResolver::tokio(config, ResolverOpts::default());
        Self(Arc::new(resolver))
    }
}

impl Resolve for DnsPublic {
    fn resolve(&self, name: Name) -> Resolving {
        let resolver = self.0.clone();
        Box::pin(async move {
            let lookup = resolver.lookup_ip(name.as_str()).await?;
            let addrs: Addrs = Box::new(lookup.into_iter().map(|ip| SocketAddr::new(ip, 0)));
            Ok(addrs)
        })
    }
}

#[derive(serde::Serialize)]
struct ReponseHttp {
    status: u16,
    #[serde(rename = "statusText")]
    status_text: String,
    headers: HashMap<String, String>,
    body: String,
}

// Requête HTTP utilisée par l'intégration WooCommerce : passe par le
// résolveur DNS public ci-dessus plutôt que par le DNS système, pour
// contourner les postes où celui-ci est mal configuré.
#[tauri::command]
async fn woo_request(
    url: String,
    method: String,
    headers: HashMap<String, String>,
    body: Option<String>,
) -> Result<ReponseHttp, String> {
    let client = reqwest::Client::builder()
        .dns_resolver(Arc::new(DnsPublic::new()))
        .build()
        .map_err(|e| e.to_string())?;

    let methode = reqwest::Method::from_bytes(method.as_bytes()).map_err(|e| e.to_string())?;
    let mut requete = client.request(methode, &url);
    for (cle, valeur) in &headers {
        requete = requete.header(cle, valeur);
    }
    if let Some(corps) = body {
        requete = requete.body(corps);
    }

    let reponse = requete.send().await.map_err(|e| e.to_string())?;
    let status = reponse.status().as_u16();
    let status_text = reponse
        .status()
        .canonical_reason()
        .unwrap_or("")
        .to_string();
    let mut headers_reponse = HashMap::new();
    for (cle, valeur) in reponse.headers().iter() {
        if let Ok(v) = valeur.to_str() {
            headers_reponse.insert(cle.to_string(), v.to_string());
        }
    }
    let body = reponse.text().await.map_err(|e| e.to_string())?;

    Ok(ReponseHttp { status, status_text, headers: headers_reponse, body })
}

// Sur certains postes (réseau d'entreprise), l'accès à internet passe par un
// proxy configuré au niveau de Windows (Paramètres → Réseau → Proxy), que les
// navigateurs utilisent automatiquement. Le client HTTP de l'app (reqwest) ne
// lit lui que les variables d'environnement HTTP_PROXY/HTTPS_PROXY — sans ça,
// les requêtes WooCommerce échouent silencieusement alors que le navigateur
// fonctionne très bien sur la même machine. On reprend donc ce réglage
// Windows et on le traduit en variables d'environnement au démarrage.
#[cfg(windows)]
fn appliquer_proxy_systeme() {
    use winreg::enums::HKEY_CURRENT_USER;
    use winreg::RegKey;

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let cle = match hkcu.open_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings") {
        Ok(k) => k,
        Err(_) => return,
    };

    let proxy_actif: u32 = cle.get_value("ProxyEnable").unwrap_or(0);
    if proxy_actif == 0 {
        return;
    }

    let proxy_serveur: String = match cle.get_value("ProxyServer") {
        Ok(v) => v,
        Err(_) => return,
    };
    let proxy_serveur = proxy_serveur.trim();
    if proxy_serveur.is_empty() {
        return;
    }

    let mut proxy_http: Option<String> = None;
    let mut proxy_https: Option<String> = None;

    if proxy_serveur.contains('=') {
        // Format par protocole : "http=host:port;https=host:port;ftp=..."
        for partie in proxy_serveur.split(';') {
            if let Some((protocole, adresse)) = partie.split_once('=') {
                let adresse = adresse.trim();
                let url = if adresse.starts_with("http://") || adresse.starts_with("https://") {
                    adresse.to_string()
                } else {
                    format!("http://{adresse}")
                };
                match protocole.trim() {
                    "http" => proxy_http = Some(url),
                    "https" => proxy_https = Some(url),
                    _ => {}
                }
            }
        }
    } else {
        // Format unique pour tous les protocoles : "host:port"
        let url = format!("http://{proxy_serveur}");
        proxy_http = Some(url.clone());
        proxy_https = Some(url);
    }

    if std::env::var("HTTP_PROXY").is_err() {
        if let Some(p) = proxy_http {
            std::env::set_var("HTTP_PROXY", p);
        }
    }
    if std::env::var("HTTPS_PROXY").is_err() {
        if let Some(p) = proxy_https {
            std::env::set_var("HTTPS_PROXY", p);
        }
    }
}

#[cfg(not(windows))]
fn appliquer_proxy_systeme() {}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    appliquer_proxy_systeme();

    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![woo_request])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
