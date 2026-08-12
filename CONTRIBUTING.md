# Участие в разработке WebForge / Contributing to WebForge

## Русский

Спасибо за помощь в развитии WebForge v1.0.0.

### Перед Pull Request

```bash
npm ci
npm run verify:source
npm run check
npm run build
npm run production:verify
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```

При возможности также запустите:

```bash
npm run tauri -- dev
```

### Правила

- не добавляйте generic shell execution из WebView;
- сохраняйте Tauri commands capability-scoped;
- сохраняйте canonical-path/traversal/symlink checks;
- не ослабляйте Workspace Trust / Terminal Access / Git Network Access без security review;
- не передавайте credentials в WebView;
- сохраняйте fail-closed behavior Designer для dynamic framework source;
- держите RU/EN localization keys парными;
- не коммитьте `node_modules`, `dist`, `src-tauri/target`, prepared runtime binaries, secrets или certificates;
- user-visible changes должны обновлять соответствующую документацию и `docs/CHANGELOG.md`.

### Документация

Публичные документы пишутся сначала полностью по-русски, затем полностью по-английски в том же файле.

### Хороший PR

Укажите:

- проблему/цель;
- краткое архитектурное решение;
- security impact, если затронуты process/filesystem/network/credentials/extensions;
- выполненные проверки;
- screenshots для заметных UI-изменений, если уместно.

---

## English

Thank you for helping improve WebForge v1.0.0.

### Before a Pull Request

```bash
npm ci
npm run verify:source
npm run check
npm run build
npm run production:verify
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```

When possible also run:

```bash
npm run tauri -- dev
```

### Rules

- do not add generic shell execution from the WebView;
- keep Tauri commands capability-scoped;
- preserve canonical-path/traversal/symlink checks;
- do not weaken Workspace Trust / Terminal Access / Git Network Access without security review;
- never expose credentials to the WebView;
- preserve fail-closed Designer behavior for dynamic framework source;
- keep RU/EN localization keys paired;
- do not commit `node_modules`, `dist`, `src-tauri/target`, prepared runtime binaries, secrets, or certificates;
- user-visible changes should update relevant documentation and `docs/CHANGELOG.md`.

### Documentation

Public documents use a complete Russian section first, followed by a complete English section in the same file.

### A good PR

Include the problem/goal, a short architecture explanation, security impact when process/filesystem/network/credentials/extensions are affected, validation steps, and screenshots for meaningful UI changes when appropriate.
