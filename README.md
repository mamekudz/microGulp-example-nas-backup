# NAS Sicherungen mit µGulp™

Dieses eigenständige Referenzprojekt sichert standardmäßig eine gefilterte Projektkopie unter einem festen Zielpfad. Neue Stände und ZIP sind unabhängig per JSON wählbar. Es läuft mit und ohne Git. Der erste CLI-/Formularlauf ist weiterhin eine Vorschau ohne Schreibzugriffe.

## Voraussetzungen

Node.js 22 oder neuer, µGulp™ 1.2.0 und API 0.8.0. Dieser Stand ist lokal für das Release vorbereitet. Das Beispiel bindet das mitgelieferte API-Archiv über einen relativen Dateipfad ein, damit die Installation vor einer npm-Veröffentlichung reproduzierbar bleibt. Nach Veröffentlichung kann die Abhängigkeit auf die Registry-Version 0.8.0 umgestellt und die Lockdatei neu erzeugt werden. Hostfunktionen sind `RequestForm.information`, `cancelable`, `rememberKey`, `µI18xContext.GetValues()` und `GetTaskRunContext()`. Die separate Backup-CLI benötigt diese Formular- und Scheduler-Funktionen nicht.

`engine: "auto"` verwendet Robocopy unter Windows und rsync unter Linux/macOS. `engine: "node"` verwendet die portable Node-Dateikopie. rsync muss installiert sein; das Rezept installiert es nicht selbst.

Windows und beide dort verwendbaren Engines wurden mit lokalen Testdateien geprüft. Ein isoliertes deutsches Browserformular bestätigt den neuen Statusbereich, vier Ziele, Abbruch und Persistenz. Linux/macOS, weitere Skins und die visuelle Abnahme in den IDE-Webviews sind noch offen. Die UI-Verträge und der Formularablauf werden zusätzlich automatisiert geprüft.

## Installation und erster Lauf

1. Das eigenständige Beispiel einschließlich `vendor/` kopieren oder später sein eigenes Repository klonen. Darin `npm ci --ignore-scripts` ausführen.
2. Die passende `nas-backup.windows.example.json` oder `nas-backup.posix.example.json` als `nas-backup.local.json` kopieren.
3. `projectId`, `source` und die Zielpfade anpassen. `source` ist relativ zur Konfigurationsdatei; Ziele sind absolute, plattformgerechte Pfade. Keine Laufwerks- oder Freigabewurzel verwenden.
4. Einen dedizierten vorhandenen Zielordner verwenden. Dort bewusst eine `.microgulp-target.json` mit passender `projectId` und `targetId` hinterlegen; `target-marker.example.json` zeigt das Format. Für die erste Erprobung ausschließlich neue lokale Testordner verwenden.
5. `npm test` und `npm run check` ausführen. Anschließend nur den Plan prüfen:

```sh
npm run backup -- --config nas-backup.local.json --targets primary
```

Der CLI-Lauf schreibt JSON nach stdout: Dateien, SHA-256-Werte, Ausschlüsse, Zielergebnisse und Modus. Ein erfolgreicher Plan enthält `status: "planned"`. Er beweist noch nicht, dass die Engine auf dem Ziel erfolgreich schreiben kann. Er legt weder Zielordner noch lokale Historie an.

Ein bewusst gestarteter Kopierlauf verwendet zusätzlich `--apply`:

```sh
npm run backup -- --config nas-backup.local.json --targets primary,secondary --apply
```

Die CLI verlangt die Ziel-IDs immer ausdrücklich. Ohne `--apply` bleibt sie unabhängig von `dryRunDefault` im Dry Run. Es gibt keinen stillen Fallback auf das erste Ziel und keine Umgebungsvariable, die unbemerkt die ausgewählten Ziele ersetzt.

## Ein Task im Dashboard

`BACKUP_TO_NAS` ist der einzige Task. Er liest die Konfiguration und zeigt Quelle, Version, Git-Zustand, Commit und lokale Erfolgszeiten je Ziel an. Danach wird genau ein `RequestForm` geöffnet. Es enthält eine Checkboxgruppe mit stabilen Ziel-IDs, optional die Zielpfade, einen Moduswähler und die Zeitplanoptionen. Auch geplante Läufe verwenden diesen Task, überspringen das Formular und nehmen die gespeicherte Zielauswahl.

Der neue optionale `information`-Bereich zeigt die Statusinformationen vor den Auswahlfeldern. Er ist Teil desselben Formulars und enthält keine Eingaben. Ein alter Host ohne diese Erweiterung kann ihn ignorieren; dafür darf dieses Beispiel nicht als vollständig unterstützte Dashboard-Integration beworben werden.

`µParameters` wird hier absichtlich nicht verwendet, weil das zusätzliche Formular vor dem Task die gewünschte Statusermittlung vor der Auswahl verhindern würde. Der neue Schlüssel `rememberKey: 'nas-backup-v1'` merkt die Zielauswahl im Host. Pfadfelder und Ausführungsmodus werden mit `remember: false` ausdrücklich nicht gemerkt; damit bleiben die Statusangaben aus der JSON-Konfiguration eindeutig. Pfadänderungen gelten nur für diesen Lauf. `nas-backup.local.json` bleibt unverändert; die geplanten Einstellungen liegen getrennt in `.microgulp/nas-backup-schedule.json`. Abbrechen liefert `null` und startet keine Sicherung.

## Wiederkehrende Sicherungen im selben Task

`BACKUP_TO_NAS` ist der einzige Task. Sein Formular zeigt Status, Ziele und bisherige Erfolgszeiten, bevor man die Checkboxen und den Modus auswählt. Im selben Formular kann der Zeitplan ein- oder ausgeschaltet, ein fünfteiliger lokaler Cron-Ausdruck eingetragen und ein eigener Zeitplanmodus gewählt werden. Die angehakten Ziel-IDs werden gemeinsam mit diesen Einstellungen unter `.microgulp/nas-backup-schedule.json` gespeichert. `.microgulp` gehört zu den sicheren Ausschlüssen und wird nicht mitgesichert.

Ein geplanter Start ruft `BACKUP_TO_NAS` erneut auf. API 0.8.0 stellt über `GetTaskRunContext()` den Auslöser bereit; bei `reason === 'schedule'` überspringt der Task das Formular und verwendet die zuvor gespeicherten Ziele und den Zeitplanmodus. Die Option „nur Zeitplan ändern“ aktualisiert die Einstellung, ohne zusätzlich sofort eine Sicherung auszuführen. Der Zeitplan und die Sicherung bleiben damit an derselben Aufgabenfunktion und derselben Zielauswahl.

Der Zeitplan ist standardmäßig aus; sein Modus beginnt als Vorschau (`dryRun: true`). Erst nach Prüfung der Ziele und der Cron-Angabe echte wiederkehrende Sicherungen ausdrücklich aktivieren. Der µGulp-Scheduler lebt nur in der geöffneten Sitzung; bei einem laufenden Task oder aktiver Dateibeobachtung wird ein Start übersprungen. Beim nächsten µGulp-Start wird eine gespeicherte aktive Deklaration wieder eingerichtet. Für Läufe bei geschlossener IDE sollte der Betriebssystem-Scheduler die eigenständige CLI ausführen.

## Feste Projektkopie als Standard, weitere Formen per JSON

Die Sicherung enthält standardmäßig die gefilterte Projektstruktur als direkt lesbare Dateien in einem festen Zielordner. Der aktuelle Stand liegt unter `<Ziel>/current/data/`. Nach einem erfolgreichen Folgelauf enthält dieser Pfad den neuen gefilterten Bestand; aus der Quelle entfernte oder inzwischen ausgeschlossene Dateien gehören dann nicht mehr dazu. Außerhalb des verwalteten Ordners current bleiben Dateien und historische Sicherungen unberührt.

Zwei unabhängige JSON-Optionen bestimmen Ablage und Format. Der folgende Ausschnitt wird als Feld in die vollständige Konfiguration eingefügt:

```json
"backup": { "mode": "fixed", "format": "directory" }
```

Das ist zugleich die Vorgabe, wenn das Feld oder einzelne Optionen fehlen. Die weiteren Kombinationen sind:

- Neue vollständige Verzeichnisstände: `"backup": { "mode": "snapshots", "format": "directory" }`.
- Ein ZIP im festen Zielstand: `"backup": { "mode": "fixed", "format": "zip" }`.
- Neue Stände mit jeweils einem ZIP: `"backup": { "mode": "snapshots", "format": "zip" }`.

`snapshots` legt pro Lauf einen neuen Ordner `<projectId>--<Zeitpunkt>-<UUID>/` an und erhält frühere Stände. `directory` enthält darin `data/`; `zip` enthält stattdessen `project.zip`. Beide Formen erhalten `manifest.json` mit Dateiliste, Prüfsummen, Sicherungsmodus und Format. ZIP komprimiert den gesamten ausgewählten Bestand, es ist keine inkrementelle Sicherung und kein atomarer Dateisystem-Snapshot.

Die feste Kopie wird zuerst in einem neuen Arbeitsordner auf demselben Ziel vollständig erstellt und geprüft. Erst dann ersetzt sie `current`; die vorherige Kopie wird anschließend entfernt. Das schützt den bisherigen Stand bei Kopier- und Prüfungsfehlern, benötigt während des Laufs aber Platz für beide Kopien. Anders als Robocopy direkt mit /MIR überträgt dieser Referenzablauf den Bestand vollständig neu. Die zwei Umbenennungen sind keine atomare Transaktion: Bei Prozessabbruch oder Verbindungsverlust kann eine Wiederherstellung des Ordnernamens erforderlich sein.

Ein vorhandenes `current` wird nur mit passendem Erfolgsmanifest für Projekt und Ziel ersetzt. Fremde Ordner werden nicht automatisch übernommen. Alte `<projectId>--...`-Stände bleiben auch nach dem Wechsel auf `fixed` erhalten. Für `snapshots` enthält dieses µGulp-Rezept (µGulp-Recipe) keine automatische Aufbewahrungsbereinigung.

**Umstieg von Rezept 1.x (µGulp-Recipe):** Ohne `backup` gilt jetzt die feste Verzeichniskopie. Wer das bisherige Verhalten behalten möchte, setzt ausdrücklich `mode: "snapshots"` und `format: "directory"`. Diese geänderte Vorgabe begründet Rezeptversion 2.0.0.

Git liefert zusätzliche Informationen, ist aber keine Voraussetzung. Der .git-Ordner bleibt im Referenzbeispiel ausgeschlossen; eine Sicherung der Git-Historie ist eine getrennte Aufgabe.

## Konfiguration

`schemaVersion` ist `1`. `projectId` und Ziel-IDs bestehen aus Kleinbuchstaben, Ziffern und Bindestrichen, beginnen mit einem Buchstaben und bleiben stabil. Das Beispiel enthält drei Ziele; ein vierter Eintrag in `targets` ergibt automatisch eine vierte Checkbox. Es gibt keine feste Dreiergrenze.

Die fünf Feature-Schalter steuern Git-Metadaten, dynamische Tasknamen, die Bearbeitung der Zielpfade im Formular, Fortsetzen nach einem Zielfehler und Vorschau als Formularstandard. Mit `git: false` bleiben Sicherung und Versionsanzeige aus lokalen Versionsdateien verfügbar. `continueOnError: true` versucht weitere Ziele, meldet den Gesamtlauf bei einem Fehler trotzdem als fehlgeschlagen.

`engine` akzeptiert `auto`, `node`, `robocopy` und `rsync`. Eine unbekannte Engine wird abgelehnt; eine nicht passende Plattform wird bei Verwendung der Verzeichniskopie abgewiesen. Im ZIP-Modus wird die Kopierengine nicht ausgeführt. `timeoutMs` begrenzt den Kopierprozess beziehungsweise die Kopierschleife. Es ist keine harte Obergrenze für blockierende Betriebssystemzugriffe auf ein ausgefallenes Dateisystem.

`exclusions.directoryNames` gilt für Verzeichnisnamen in jeder Tiefe. `relativePaths` gilt ausschließlich relativ zum Quellstamm. `fileNames` gilt für exakte Dateinamen. Diese drei Listen unterstützen bewusst keine freien Shell- oder Glob-Ausdrücke. Beispiel: `relativePaths: ["build"]` lässt `src/build` unverändert zu. Die Vergleiche erfolgen vorsichtshalber auch auf POSIX ohne Beachtung der Groß-/Kleinschreibung.

Verbindlich ausgeschlossen sind `.git`, `.recipe-state`, `.microgulp`, `node_modules`, `.ssh`, `.aws`, `.env`, `.env.*`, `.npmrc`, `.netrc`, `nas-backup.local.json` und Dateien mit Endungen `.pem`, `.key`, `.p12`, `.pfx`. Diese konservative Auswahl ist kein vollständiger Geheimnisscanner. Wertvolle Dateien mit solchen Namen benötigen eine gesonderte, bewusst geprüfte Sicherungsstrategie. Weitere projektspezifische Geheimnisse müssen ergänzend ausgeschlossen werden.

`config.schema.json` unterstützt Editoren. `ValidateConfig` prüft zusätzlich unter anderem doppelte Ziel-IDs, native absolute Zielpfade und Pfadbestandteile. Pfadüberschneidungen und Zielidentität werden vor dem Kopieren geprüft. Die JSON-Konfiguration akzeptiert keine ausführbaren Kommandos.

## Git und Displayname

Version: erster Eintrag in `RELEASES.json` (`main.minor.revision` und optional `ß`), danach `package.json`, danach bei verfügbarem Git `git describe`. Beschädigte RELEASES-Metadaten erzeugen einen Hinweis. Ohne Versionsquelle steht `-`.

Git wird über das ausführbare Git-Programm erkannt; eine `.git`-Datei in Worktrees ist deshalb kein Problem. Ein Elternrepository kann zum Projekt gehören. Ohne Repository lautet der Zustand `none`, vor dem ersten Commit `unborn`, bei nicht verfügbarem oder fehlerhaftem Git `unavailable`. Ein Git-Fehler verhindert die Dateisicherung nicht. Dirty umfasst Änderungen und unversionierte, nicht ignorierte Dateien im Repository; es ist keine Aussage über ungespeicherte Editorinhalte.

Der Taskname zeigt standardmäßig nur Name und Version; Commit, Änderungszeichen und jüngster lokal bekannter Erfolg sind einzeln zuschaltbar. `?` bedeutet unbekannt, `-` keinen lokal bekannten Wert. Er sagt nicht, dass alle Ziele gesichert sind. Die Einzelzeiten im Formularkopf und im Log sind hierfür maßgeblich. NAS-Ziele werden für den Displaynamen nicht abgefragt.

`µI18xContext.GetValues()` liefert einen gemeinsamen frischen Stand der lokalen Metadaten pro Scan. Die Methode sitzt in einem Objekt und erzeugt keinen zusätzlichen Taskexport. Metadaten bleiben registrierte i18x-Quelltexte. `NotifyTasksChanged()` fordert nach dem Lauf einen frischen Scan an. Änderungen außerhalb eines Laufs sind spätestens nach einem manuellen Rescan sichtbar; eine ständige Git-Überwachung wird nicht versprochen.

## Datenlayout und Erfolgskriterium

Der feste Stand liegt unter `current/`, optionale neue Stände unter `<projectId>--<Zeitpunkt>-<UUID>/`. Darin liegen `started.json`, entweder `data/` oder `project.zip` und bei Erfolg `manifest.json`. Arbeitsordner verbleiben bei Fehlern zur Diagnose. Ein geprüftes Manifest im Arbeitsordner bestätigt dessen Inhalt, aber erst der Pfad `current/` bezeichnet im festen Modus den übernommenen Stand. Der gemeinsame Quellbestand wird vor dem Kopieren gehasht; die Kopien werden anschließend anhand dieser SHA-256-Werte geprüft. Danach wird die Quelle erneut inventarisiert. Nur ein unveränderter Bestand erzeugt das Erfolgsmanifest. Ein teilweise kopierter Ordner ohne gültiges Erfolgsmanifest ist keine erfolgreiche Sicherung.

`manifest.json` enthält Ziel-ID, Lauf-ID, Rezeptversion, Engine, Zeiten, Konfigurationshash, Git-Metadaten, Ausschlussregeln und die relativen Dateipfade mit Größe und Hash. Manifeste sind private Backup-Metadaten und werden nicht automatisch veröffentlicht. Pro Lauf und Ziel entsteht außerdem eine neue lokale Ergebnisdatei unter `<source>/.recipe-state/history/`. Dry Runs schreiben dort nichts. Ein späterer Fehler überschreibt nicht den letzten Erfolgszeitpunkt.

Die lokale Historie ist ein Anzeigecache. Gelöschte oder unlesbare lokale Historie kann nicht alle NAS-Stände wiedergeben; beschädigte einzelne Einträge werden übersprungen. Auf dem NAS sind die gültigen Manifeste der maßgebliche Nachweis. Eine fehlgeschlagene lokale Historienablage meldet den Lauf als Fehler, auch wenn bereits ein gültiger Sicherungsstand existiert.

## Fehler und Grenzen

- `CONFIG_*`: Konfiguration korrigieren; unbekannte Felder werden nicht still ignoriert.
- `TARGET_OVERLAP`, `TARGET_ALIAS`, `UNSAFE_DIRECTORY`: Quelle und Ziele trennen; Verknüpfungen und Junctions sind absichtlich nicht zulässig.
- `TARGET_MARKER`, `ENOENT`: Zielverbindung und Identitätsdatei prüfen. Das Rezept erstellt keinen Ersatzordner für ein fehlendes NAS.
- `SOURCE_CHANGED`, `VERIFY_FAILED`: Quelle während des Laufs verändert oder Kopie stimmt nicht. Der unvollständige Stand bleibt zur Diagnose erhalten.
- `ENGINE_TIMEOUT`, `ENGINE_FAILED`: Kopierprozess gescheitert. Signale und fehlende Exitcodes gelten stets als Fehler; Robocopy 0 bis 7 als Erfolg, ab 8 als Fehler. Zusätzliche Inhaltsprüfung bleibt verbindlich.
- `EEXIST` beim lokalen `backup.lock`: Ein Lauf arbeitet bereits oder wurde hart beendet. Erst nach Prüfung, dass kein Prozess mehr läuft, die genau bezeichnete lokale Sperrdatei manuell entfernen. Keine automatische Sperrübernahme.

Alle Engines sichern reguläre Dateien und ihren Inhalt. Leere Ordner, ACLs, Besitzer, erweiterte Attribute, alternative Datenströme und eine vollständig wiederherstellbare Git-Datenbank sind nicht Teil des gemeinsamen Vertrags. Symlinks, Junctions, Hardlinks und Sonderdateien werden außerhalb ausgeschlossener Bäume abgelehnt. Git-Historie benötigt eine getrennte Git-/Bundle-Sicherung.

Die Quelle sollte während der Sicherung ruhig bleiben. Die nachträgliche Quellprüfung erkennt viele Änderungen, erzeugt aber keinen atomaren Dateisystem- oder Datenbank-Snapshot. Betriebssystemseitige VSS-/ZFS-/Btrfs-Snapshots sind eine spätere Engine-Erweiterung. Verzeichnisse dürfen während eines Laufs nicht durch andere Prozesse ausgetauscht werden. Netzwerk-Mount-Aliasse und absichtliche Dateisystemrennen sind keine vollständig lösbare Grenze dieser portablen Dateikopie.

Robocopy führt im Referenzadapter einen Prozess pro Datei aus. Das ist transparent und einfach prüfbar, bei großen Dateibeständen aber langsam. Die portable Node-Engine ist eine Alternative; weitere Optimierungen müssen dieselben Auswahl- und Verifikationsregeln erhalten. Native Dateisystemaufrufe können bei einem gestörten NAS länger blockieren als das Engine-Timeout. Ein separater Prozess pro kompletten Ziellauf wäre die nächste Härtung.

## Wiederherstellung prüfen

Einen Stand mit lesbarem Erfolgsmanifest auswählen. Bei `directory` dessen `data/` in einen neuen leeren Testordner kopieren. Bei `zip` zuerst die Archivprüfsumme aus `manifest.archive.sha256` prüfen und `project.zip` in einen neuen leeren Testordner entpacken. Die relativen Pfade, Größen und SHA-256-Werte gegen das Manifest prüfen; erst danach die Anwendung aus diesem Ordner testen. Niemals einen unvollständigen Stand automatisch über das aktive Projekt kopieren. Das µGulp-Rezept enthält keinen Restore-Task, der bestehende Arbeitsdateien überschreibt. Ein automatisierter Wiederherstellungstest mit Kopie in einen separaten Ordner ist Bestandteil der Tests.

## Anpassung und Integration

`src/Task.mjs` ist der UI-Adapter, `Config.mjs` validiert, `Inventory.mjs` legt den verbindlichen Dateibestand fest, `Engines.mjs` kopiert, `Zip.mjs` archiviert und prüft, `Storage.mjs` ersetzt den festen Stand und `Backup.mjs` koordiniert. Eine neue Engine erhält `{source, destination, files, engine, timeoutMs}`. Sie darf ausschließlich in das neue, leere `data/` schreiben; die zentrale Verifikation bleibt erhalten.

Im gesicherten Projekt `.recipe-state/` und lokale Konfiguration bewusst in dessen `.gitignore` aufnehmen, damit Laufhistorie nicht selbst Dirty erzeugt. Das Muster ändert diese Datei in fremden Projekten nicht. Bestehende `µGroups`, Ausführungsrestriktionen und i18x-Wörterbücher beim Einbau erhalten. Weitere Sprachen mit denselben Schlüsseln und Platzhaltern ergänzen. Der [Integrationsprompt](https://microgulp.dev/blog-assets/nas-backup/prompts/IntegrateRecipe.de-DE.src.md) führt durch die Bestandsprüfung.

## Eigene Versionshistorie

`RELEASES.json` ist die einzige Quelle der Beispielversion (neuester Eintrag zuerst). Englische Releasehinweise tragen `<context="release info"/>`; die Wörterbücher unter `i18x/gulp` enthalten die Sprachfassungen. Ein Eintrag bedeutet noch keine Veröffentlichungsfreigabe.

`npm run release:check` prüft Versionen; `npm run release:sync` gleicht package.json und die Wurzel der Lockdatei ab. `npm run release:history -- --language=de-DE` zeigt die Historie. Die Prüfung läuft auch vor npm test.

Für eine Änderung oben einen neuen Releaseeintrag ergänzen, Sprachfassungen nachziehen, synchronisieren, Tests ausführen und danach den geprüften Commit in article.json festhalten. Frühere Einträge erhalten. Ein Versionsbump veröffentlicht weder Paket noch Repository.

## Kompakter Taskname

Standard: NAS-Sicherung V2.3.5. Optionales JSON-Feld `displayName`: `{"version":true,"commit":false,"changes":false,"lastBackup":false}`. Jeder Schalter ist unabhängig; fehlende Schalter verwenden diese Vorgaben. `features.dynamicDisplayName: false` zeigt nur NAS-Sicherung. Bestehende Konfigurationen bleiben gültig.

Mit `changes: true` zeigt i18x ✓ für einen sauberen Git-Stand, ✎ für Änderungen und ? für unbekannt/nicht verfügbar. Gemeint sind Git-Änderungen, nicht ungespeicherte Editorpuffer. Mit `lastBackup: true` erscheint ausschließlich Datum/Uhrzeit im vorhandenen i18x-Format `stdDateTime`, ohne Beschriftung und ohne Sekunden. Fehlt ein verzeichneter erfolgreicher Lauf, entfällt der gesamte Abschnitt einschließlich Trennzeichen. Der Wert ist der neueste lokal verzeichnete Erfolg eines aktuell konfigurierten Ziels, keine Zusage über alle Ziele. Fehlende Historie beweist nicht, dass auf einem NAS niemals eine Sicherung existiert hat.

`targets[].label` bestimmt die frei wählbaren Zielbeschriftungen. Formular und dessen Darstellung bleiben unverändert. Weitere Sprachen werden erst zum Abschluss erstellt.

## Projekttitel und Logo in µGulp

Diesen Beispielordner als eigenen Workspace öffnen. `microgulp.config.json` zeigt **µGulp Example: NAS Backup** oberhalb der Taskliste. `project.title` und `project.description` lassen sich dort anpassen; `project.logo` verweist auf die mitgelieferte Datei `assets/microgulp-logo.png`. Der Pfad bleibt relativ zum Beispiel-Workspace. Die Projektkennung ist keine Gulpfile-Eigenschaft und verändert keine technischen Tasknamen. Bei mehreren Gulpfiles in demselben Workspace gilt derselbe Projekttitel.

## Austausch, Sperren und Wiederanlauf

Eine Sperrdatei in der Quelle und `.microgulp-backup.lock` am Ziel verhindern parallele Rezeptläufe auf denselben Daten. Nach einem Absturz Sperren erst nach Prüfung auf noch laufende Prozesse manuell entfernen. Ist `current` verschwunden und `.previous-<runId>` vorhanden, dessen Manifest/Inhalte prüfen und den vorherigen Stand bei Bedarf manuell zurückbenennen; der Task nimmt keine automatische Löschung oder Wiederaufnahme vor. In einem fehlgeschlagenen Arbeitsordner kann bereits ein inhaltlich gültiges Manifest liegen, obwohl die Veröffentlichung als `current` scheiterte. Das ist kein erfolgreicher abgeschlossener Lauf. Externe Schreibzugriffe während der Sicherung vermeiden.

Die ZIP-Abhängigkeiten sind yazl 3.3.1 und yauzl 3.4.0, jeweils MIT; Lizenztexte werden mit den npm-Paketen installiert. ZIP-Erzeugung und Entpackprüfung haben ein Timeout, native blockierende Dateisystemzugriffe und Hashläufe keine garantierte harte Gesamtdauer. Das feste Schema verwendet bewusst einen verwalteten Unterordner: vorhandene flache NAS-Kopien werden nicht automatisch migriert oder entfernt.

## Kurztasten im Dashboard

- `BACKUP_TO_NAS`: Windows/Linux `Ctrl+Shift+F3`, macOS `Cmd+Shift+F3`.

Zuerst das µGulp-Dashboard fokussieren. Die Kurztaste startet denselben Task wie ein Klick, einschließlich eines vorhandenen Taskformulars; sie wählt keine Formularwerte vor und sendet das Formular nicht ab. In Texteingabefeldern werden keine Task-Kurztasten ausgelöst. Die Belegungen gelten im Dashboard, nicht IDE-weit. Falls IDE oder Betriebssystem eine Kombination abfangen, lässt sich `µKeyBinding` im Gulpfile ändern. Manche Tastaturen benötigen zusätzlich Fn für Funktionstasten.

```javascript
BACKUP_TO_NAS.µKeyBinding = { key: 'ctrl+shift+F3', mac: 'cmd+shift+F3' };
```

<!-- blog-publication:start -->
Artikel: [Deutsch](https://microgulp.dev/de/blog/nas-backup/)

Weitere Beispiele: [microGulp-Examples](https://github.com/mamekudz/microGulp-Examples).
<!-- blog-publication:end -->
