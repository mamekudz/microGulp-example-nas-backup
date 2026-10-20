export const DISPLAY_DEFAULTS = { version: true, commit: false, changes: false, lastBackup: false };

/** Compose a registered phrase; values remain unresolved until host i18x rendering. */
export function DisplayName(_config, _hasBackup) {
	if (!_config.features.dynamicDisplayName) return 'NAS backup<context="µDisplayName"/>';
	let options = { ...DISPLAY_DEFAULTS, ..._config.displayName };
	return 'NAS backup' + (options.version ? ' V<version/>' : '')
		+ (options.commit ? ' | <commit/>' : '')
		+ (options.changes ? ' | <dirty enumeration="✓|✎|?"/>' : '')
		+ (options.lastBackup && _hasBackup ? ' | <lastBackup format="stdDateTime"/>' : '')
		+ '<context="µDisplayName"/>';
}
