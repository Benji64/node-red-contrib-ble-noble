# node-red-contrib-ble-noble

Modern Bluetooth Low Energy (BLE) nodes for Node-RED, built on **@abandonware/noble**.

Compatible with : Node.js 18/20 · Node-RED 3.x · Raspberry Pi OS Bookworm · BlueZ 5.6x+

---

## Architecture

Ce module expose **3 nœuds** :

```
[BLE Controller]  ← config node partagé (1 seule instance)
[BLE Scan]        ← découverte des appareils à proximité
[BLE Device]      ← tout-en-un : connexion, souscription, écriture
```

> **Note v2.0** : Les anciens nœuds `ble-in` et `ble-out` ont été supprimés.
> Toutes leurs fonctions sont désormais intégrées dans **BLE Device**.

---

## Installation

```bash
cd ~/.node-red
npm install node-red-contrib-ble-noble
sudo systemctl restart nodered
```

### Permissions Bluetooth (Linux)

Sur Raspberry Pi / Armbian, noble nécessite des droits sur le socket BLE :

```bash
sudo setcap cap_net_raw+eip $(eval readlink -f `which node`)
```

---

## Nœuds

### BLE Controller *(config node)*

Node de configuration partagé. Gère :
- l'initialisation de noble et le suivi de l'état (`poweredOn` / off)
- le démarrage / arrêt du scan BLE
- le cache des périphériques découverts
- la connexion aux périphériques (arrête le scan avant de connecter, comme l'exige noble)

> Ajouter **une seule instance** et la référencer dans tous les autres nœuds.

---

### BLE Scan

Découvre les appareils BLE à proximité et émet un message par appareil détecté.

#### Entrée

| `msg.payload` | Action |
|---|---|
| `"start"` | Démarre le scan |
| `"stop"` | Arrête le scan |
| `"toggle"` | Bascule l'état |

#### Sortie 1

```js
msg.payload = {
  id:   "aa:bb:cc:dd:ee:ff",  // identifiant unique
  name: "MonAppareil",         // nom BLE (vide si non diffusé)
  rssi: -72                    // puissance du signal en dBm
}
```

#### Options

| Option | Description |
|---|---|
| **Auto-start** | Démarre le scan automatiquement au déploiement du flow |

---

### BLE Device *(tout-en-un)*

Gère l'intégralité du cycle de vie d'un appareil BLE : connexion, découverte des services, souscription aux notifications et écriture sur des caractéristiques.

#### Entrée — `msg.command`

| Commande | Paramètres | Action |
|---|---|---|
| `"connect"` *(défaut)* | — | Connecte et découvre les services/caractéristiques |
| `"subscribe"` | `msg.char` = UUID | Souscrit aux notifications d'une caractéristique |
| `"write"` | `msg.char` + `msg.payload` | Écrit sur une caractéristique |
| `"disconnect"` | — | Déconnecte proprement |

**Pour `"write"` :**
- `msg.payload` : `Buffer`, tableau d'octets, ou `string` (UTF-8 par défaut)
- `msg.withoutResponse = true` : write without response (optionnel)

Si `msg.command` est absent, `"connect"` est utilisé par défaut.  
Si `msg.char` est absent, la valeur **Default char UUID** configurée dans le nœud est utilisée.

#### Sorties

| # | Topic | Contenu |
|---|---|---|
| 1 | `services` | Liste des services et caractéristiques découverts après connexion |
| 2 | `notification` | Données reçues en souscription — `msg.payload` = `Buffer` brut |
| 3 | `write-ack` | Confirmation d'écriture réussie |

**Sortie 1 — format services :**
```js
msg.payload = [
  {
    serviceUuid: "180d",
    characteristics: [
      { uuid: "2a37", properties: ["notify"] },
      { uuid: "2a38", properties: ["read"] }
    ]
  }
]
```

**Sortie 2 — format notification :**
```js
msg.payload  // Buffer brut — à parser selon le protocole de l'appareil
msg.char     // UUID de la caractéristique source
msg.device   // ID du périphérique
```

#### Options avancées

| Option | Description |
|---|---|
| **Device ID** | Adresse MAC ou UUID du périphérique (doit avoir été découvert par BLE Scan) |
| **Default char UUID** | UUID utilisé si `msg.char` est absent dans la commande |
| **Subscribe on connect** | Liste d'UUID souscrites automatiquement après chaque connexion |
| **Auto-reconnect** | Reconnexion automatique après déconnexion (délai 5 s) |

---

## Exemple de flow typique

```
[inject "start"] → [BLE Scan] → [switch: id == "aa:bb:cc:dd:ee:ff"]
                                        ↓
                               [change: command = "connect"]
                                        ↓
                               [BLE Device] → sortie 1 : services découverts
                                           → sortie 2 : notifications reçues
                                           → sortie 3 : ack écriture

[inject write]   → [change: command="write", char="2a37", payload=<Buffer>]
                                        ↓
                               [BLE Device]
```

---

## Changelog

### v2.0.0
- **Suppression** de `ble-in` et `ble-out` — fonctions intégrées dans `ble-device`
- **BLE Scan** : ajout d'une entrée pour contrôler le scan (`start` / `stop` / `toggle`) + option auto-start
- **BLE Device** : nœud tout-en-un avec 3 sorties (services / notifications / write ack), auto-subscribe configurable, auto-reconnect

### v1.0.0
- Version initiale (non fonctionnelle — fichier `ble-controller.js` manquant, fichiers JS/HTML dupliqués)
