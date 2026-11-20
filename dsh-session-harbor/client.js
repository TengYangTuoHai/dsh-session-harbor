window.__ModuleLoader__.load({
  id: 'dsh-session-harbor',
  factory(require) {
    const React = require('react');
    const { createPortal } = require('react-dom');
    const {
      Button, Input, Menu, Modal, IconCheckOutlineRegular, IconChevronDownOutlineRegular,
      IconChevronRightOutlineRegular, IconEditOutlineRegular, IconFolderCloseRegular,
      IconFolderOpenRegular, IconPlusOutlineRegular, IconWarningOutlineRegular,
    } = require('@deepseek-ai/dsh-client-ui-primitives');
    const h = React.createElement;
    const NS = 't3-session-sidebar';
    const GROUPS = ['pinned', 'active', 'working', 'settled'];
    const DEFAULT_COLLAPSED = Object.freeze({ working: true, settled: true });
    const dictionaries = {
      en: {
        enable: 'Use Session Harbor', native: 'Use native sidebar', nativeShort: 'Use native',
        sessions: 'Sessions',
        viewOptions: 'View options', addWorkspace: 'Add workspace',
        pinned: 'Pinned', active: 'Active', working: 'Working', settled: 'Settled',
        pin: 'Pin', unpin: 'Unpin', settle: 'Settle', unsettle: 'Unsettle', untitled: 'Untitled session',
        empty: 'No sessions', loading: 'Loading sessions…', syncing: 'Session placement unavailable. Retrying…',
        actionFailed: 'Action failed. Check the current state and retry.', openFailed: 'Could not open session.',
        sessionInUse: 'This session is in use in another window or terminal. Close it there and retry.',
        expand: 'Open sidebar',
        menuDone: 'Session marked as settled.', menuRestored: 'Session reactivated.', more: 'Session actions',
        timeNow: 'now', timeMinutes: '{n}min', timeHours: '{n}h', timeDays: '{n}d', timeMonths: '{n}mo', timeYears: '{n}y',
        statusOngoing: 'Working', statusWarning: 'Waiting for you', statusDone: 'Finished', waitingCount: '{n} waiting',
        remoteOn: 'On {name}', remotePickMachine: 'Machine', remoteError: 'Machine mirror unavailable. Retrying…', remoteUnknown: 'Unknown state',
        remoteOfflineNote: '{name} is not answering — showing the last sync',
        remoteReady: 'Connected', remoteConnecting: 'Connecting', remoteStale: 'Out of date', remoteDown: 'Offline', remoteIncompatible: 'Session placement version mismatch',

        remoteAddProject: 'Add project on another machine', remoteDeleteProject: 'Delete project',
        remoteDeviceChip: 'Device', remoteDeviceThisMachine: 'This machine', remoteDeviceBack: 'All devices',
        remoteDeviceNoProjects: 'No project on that machine yet', remoteDeviceStarting: 'Starting…',
        remoteDeviceFailed: 'Could not start that session', remoteDeviceUnreachable: 'That machine is not reachable',
        remoteDeviceCreated: 'Session started on {name}',
        newSession: 'New session', chooseDeviceProject: 'Choose a device and project', project: 'Project', chooseProject: 'Choose a project',
        deviceHint: 'Choose where this session runs, then select a project on that device.',
        remoteOpening: 'Opening session…', remoteOpen: 'Open session', retry: 'Retry',
        remoteDisconnected: 'The device disconnected. The session will reopen when it reconnects.',
        remoteStreamReconnecting: 'Reconnecting to the session…',
        rename: 'Rename', renameTitle: 'Session name', save: 'Save', fork: 'Fork session', archive: 'Archive', copyId: 'Copy session ID',
        copyDone: 'Session ID copied.', close: 'Close', localNoProjects: 'Add a project to start a session.' ,
        remoteChoose: 'Open', remotePath: 'Edit path', remoteHome: 'Home', projectFolderTitle: 'Select Workspace Directory', folderName: 'Folder name',
        remoteShowHidden: 'Show hidden folders', remoteTruncated: 'Too many folders to list here — filter or type a path.', remoteEmptyLevel: 'No folders here', remoteLoading: 'Loading…',
        remoteNewFolder: 'New folder', remoteCreate: 'Create', remoteCancel: 'Cancel', remoteWorking: 'Working…',
        remoteDeleteTitle: 'Delete project', remoteDeleteBody: 'This cannot be undone. The folder itself stays on the machine.',
        remoteDeleteMachine: 'Machine', remoteDeletePath: 'Folder', remoteDeleteSessions: 'Sessions', remoteDeleteCount: '{n}', remoteDeleteConfirm: 'Delete project'
      },
      ja: {
        enable: 'Session Harborに切り替え',
        native: '標準サイドバーに切り替え',
        nativeShort: '標準に切り替え',
        sessions: 'セッション',
        viewOptions: '表示オプション',
        addWorkspace: 'ワークスペースを追加',
        pinned: 'ピン留め済み',
        active: 'アクティブ',
        working: '作業中',
        settled: '完了済み',
        pin: 'ピン留め',
        unpin: 'ピン留めを解除',
        settle: '完了にする',
        unsettle: 'アクティブに戻す',
        untitled: '無題のセッション',
        empty: 'セッションはありません',
        loading: 'セッションを読み込み中…',
        syncing: 'セッションの分類を同期できません。再試行中…',
        actionFailed: '操作に失敗しました。現在の状態を確認して再試行してください。',
        openFailed: 'セッションを開けませんでした。',
        sessionInUse: '別のウィンドウまたはターミナルで使用中です。そちらで閉じてから再試行してください。',
        expand: 'サイドバーを開く',
        menuDone: 'セッションを完了にしました。',
        menuRestored: 'セッションをアクティブに戻しました。',
        more: 'セッションの操作',
        timeNow: 'たった今',
        timeMinutes: '{n}分',
        timeHours: '{n}時間',
        timeDays: '{n}日',
        timeMonths: '{n}か月',
        timeYears: '{n}年',
        statusOngoing: '作業中',
        statusWarning: 'ユーザーの操作待ち',
        statusDone: '終了',
        waitingCount: '操作待ち {n}件',
        remoteOn: '{name}上のセッション',
        remotePickMachine: 'マシン',
        remoteError: 'リモートマシンを同期できません。再試行中…',
        remoteUnknown: '状態不明',
        remoteOfflineNote: '{name}から応答がありません。前回同期したデータを表示しています。',
        remoteReady: '接続済み',
        remoteConnecting: '接続中',
        remoteStale: 'データが古い',
        remoteDown: 'オフライン',
        remoteIncompatible: 'セッションの分類機能のバージョンが一致しません',
        remoteAddProject: '別のマシンにプロジェクトを追加',
        remoteDeleteProject: 'プロジェクトを削除',
        remoteDeviceChip: 'デバイス',
        remoteDeviceThisMachine: 'このマシン',
        remoteDeviceBack: 'すべてのデバイス',
        remoteDeviceNoProjects: 'このマシンにはまだプロジェクトがありません',
        remoteDeviceStarting: 'セッションを作成中…',
        remoteDeviceFailed: 'セッションを開始できませんでした',
        remoteDeviceUnreachable: 'このマシンに接続できません',
        remoteDeviceCreated: '{name}でセッションを開始しました',
        newSession: '新規セッション',
        chooseDeviceProject: 'デバイスとプロジェクトを選択',
        project: 'プロジェクト',
        chooseProject: 'プロジェクトを選択',
        deviceHint: 'セッションを実行するデバイスを選んでから、そのデバイス上のプロジェクトを選択してください。',
        remoteOpening: 'セッションを開いています…',
        remoteOpen: 'セッションを開く',
        retry: '再試行',
        remoteDisconnected: 'デバイスとの接続が切れました。再接続するとセッションが開きます。',
        remoteStreamReconnecting: 'セッションに再接続中…',
        rename: '名前を変更',
        renameTitle: 'セッション名',
        save: '保存',
        fork: 'セッションをフォーク',
        archive: 'アーカイブ',
        copyId: 'セッションIDをコピー',
        copyDone: 'セッションIDをコピーしました。',
        close: '閉じる',
        localNoProjects: 'セッションを開始するには、プロジェクトを追加してください。',
        remoteChoose: '開く',
        remotePath: 'パスを編集',
        remoteHome: 'ホーム',
        projectFolderTitle: 'ワークスペースのフォルダーを選択',
        folderName: 'フォルダー名',
        remoteShowHidden: '隠しフォルダーを表示',
        remoteTruncated: 'フォルダーが多すぎます。絞り込むか、パスを入力してください。',
        remoteEmptyLevel: 'ここにフォルダーはありません',
        remoteLoading: '読み込み中…',
        remoteNewFolder: '新規フォルダー',
        remoteCreate: '作成',
        remoteCancel: 'キャンセル',
        remoteWorking: '処理中…',
        remoteDeleteTitle: 'プロジェクトを削除',
        remoteDeleteBody: 'この操作は元に戻せません。フォルダーはマシン上に残ります。',
        remoteDeleteMachine: 'マシン',
        remoteDeletePath: 'フォルダー',
        remoteDeleteSessions: 'セッション数',
        remoteDeleteCount: '{n}',
        remoteDeleteConfirm: 'プロジェクトを削除',
      },
      es: {
        enable: 'Usar Session Harbor',
        native: 'Usar la barra lateral nativa',
        nativeShort: 'Usar barra nativa',
        sessions: 'Sesiones',
        viewOptions: 'Opciones de vista',
        addWorkspace: 'Agregar espacio de trabajo',
        pinned: 'Fijadas',
        active: 'Activas',
        working: 'En curso',
        settled: 'Completadas',
        pin: 'Fijar',
        unpin: 'Desfijar',
        settle: 'Marcar como completada',
        unsettle: 'Reactivar',
        untitled: 'Sesión sin título',
        empty: 'No hay sesiones',
        loading: 'Cargando sesiones…',
        syncing: 'No se pudo sincronizar la agrupación de sesiones. Reintentando…',
        actionFailed: 'La acción falló. Comprueba el estado actual y vuelve a intentarlo.',
        openFailed: 'No se pudo abrir la sesión.',
        sessionInUse: 'Esta sesión está en uso en otra ventana o terminal. Ciérrala allí y vuelve a intentarlo.',
        expand: 'Abrir barra lateral',
        menuDone: 'Sesión marcada como completada.',
        menuRestored: 'Sesión reactivada.',
        more: 'Acciones de la sesión',
        timeNow: 'ahora',
        timeMinutes: '{n} min',
        timeHours: '{n} h',
        timeDays: '{n} d',
        timeMonths: '{n} mes.',
        timeYears: '{n} a',
        statusOngoing: 'En curso',
        statusWarning: 'Se requiere tu intervención',
        statusDone: 'Finalizado',
        waitingCount: '{n} en espera',
        remoteOn: 'En {name}',
        remotePickMachine: 'Equipo',
        remoteError: 'No se pudo sincronizar el equipo remoto. Reintentando…',
        remoteUnknown: 'Estado desconocido',
        remoteOfflineNote: 'Sin respuesta de {name}. Se muestran los últimos datos sincronizados.',
        remoteReady: 'Conectado',
        remoteConnecting: 'Conectando',
        remoteStale: 'Desactualizado',
        remoteDown: 'Sin conexión',
        remoteIncompatible: 'Versiones de agrupación de sesiones incompatibles',
        remoteAddProject: 'Agregar proyecto en otro equipo',
        remoteDeleteProject: 'Eliminar proyecto',
        remoteDeviceChip: 'Dispositivo',
        remoteDeviceThisMachine: 'Este equipo',
        remoteDeviceBack: 'Todos los dispositivos',
        remoteDeviceNoProjects: 'Aún no hay proyectos en ese equipo',
        remoteDeviceStarting: 'Iniciando…',
        remoteDeviceFailed: 'No se pudo iniciar la sesión',
        remoteDeviceUnreachable: 'No se puede acceder a ese equipo',
        remoteDeviceCreated: 'Sesión iniciada en {name}',
        newSession: 'Nueva sesión',
        chooseDeviceProject: 'Elegir un dispositivo y un proyecto',
        project: 'Proyecto',
        chooseProject: 'Elegir un proyecto',
        deviceHint: 'Elige en qué dispositivo se ejecutará la sesión y selecciona un proyecto en él.',
        remoteOpening: 'Abriendo sesión…',
        remoteOpen: 'Abrir sesión',
        retry: 'Reintentar',
        remoteDisconnected: 'El dispositivo se desconectó. La sesión se volverá a abrir cuando se restablezca la conexión.',
        remoteStreamReconnecting: 'Reconectando con la sesión…',
        rename: 'Cambiar nombre',
        renameTitle: 'Nombre de la sesión',
        save: 'Guardar',
        fork: 'Bifurcar sesión',
        archive: 'Archivar',
        copyId: 'Copiar ID de sesión',
        copyDone: 'ID de sesión copiado.',
        close: 'Cerrar',
        localNoProjects: 'Agrega un proyecto para iniciar una sesión.',
        remoteChoose: 'Abrir',
        remotePath: 'Editar ruta',
        remoteHome: 'Carpeta personal',
        projectFolderTitle: 'Seleccionar carpeta del espacio de trabajo',
        folderName: 'Nombre de la carpeta',
        remoteShowHidden: 'Mostrar carpetas ocultas',
        remoteTruncated: 'Hay demasiadas carpetas para mostrarlas aquí. Filtra la lista o escribe una ruta.',
        remoteEmptyLevel: 'No hay carpetas aquí',
        remoteLoading: 'Cargando…',
        remoteNewFolder: 'Nueva carpeta',
        remoteCreate: 'Crear',
        remoteCancel: 'Cancelar',
        remoteWorking: 'Procesando…',
        remoteDeleteTitle: 'Eliminar proyecto',
        remoteDeleteBody: 'Esta acción no se puede deshacer. La carpeta se conservará en el equipo.',
        remoteDeleteMachine: 'Equipo',
        remoteDeletePath: 'Carpeta',
        remoteDeleteSessions: 'Sesiones',
        remoteDeleteCount: '{n}',
        remoteDeleteConfirm: 'Eliminar proyecto',
      },
      fr: {
        enable: 'Utiliser Session Harbor',
        native: 'Utiliser la barre latérale native',
        nativeShort: 'Utiliser la barre native',
        sessions: 'Sessions',
        viewOptions: 'Options d’affichage',
        addWorkspace: 'Ajouter un espace de travail',
        pinned: 'Épinglées',
        active: 'Actives',
        working: 'En cours',
        settled: 'Terminées',
        pin: 'Épingler',
        unpin: 'Désépingler',
        settle: 'Marquer comme terminée',
        unsettle: 'Réactiver',
        untitled: 'Session sans titre',
        empty: 'Aucune session',
        loading: 'Chargement des sessions…',
        syncing: 'Impossible de synchroniser le classement des sessions. Nouvelle tentative…',
        actionFailed: 'L’action a échoué. Vérifiez l’état actuel et réessayez.',
        openFailed: 'Impossible d’ouvrir la session.',
        sessionInUse: 'Cette session est utilisée dans une autre fenêtre ou un autre terminal. Fermez-la, puis réessayez.',
        expand: 'Ouvrir la barre latérale',
        menuDone: 'Session marquée comme terminée.',
        menuRestored: 'Session réactivée.',
        more: 'Actions de la session',
        timeNow: 'à l’instant',
        timeMinutes: '{n} min',
        timeHours: '{n} h',
        timeDays: '{n} j',
        timeMonths: '{n} mois',
        timeYears: '{n} a',
        statusOngoing: 'En cours',
        statusWarning: 'En attente de votre intervention',
        statusDone: 'Terminé',
        waitingCount: '{n} en attente',
        remoteOn: 'Sur {name}',
        remotePickMachine: 'Machine',
        remoteError: 'Impossible de synchroniser la machine distante. Nouvelle tentative…',
        remoteUnknown: 'État inconnu',
        remoteOfflineNote: 'Aucune réponse de {name}. Affichage des dernières données synchronisées.',
        remoteReady: 'Connectée',
        remoteConnecting: 'Connexion en cours',
        remoteStale: 'Données obsolètes',
        remoteDown: 'Hors ligne',
        remoteIncompatible: 'Versions de classement des sessions incompatibles',
        remoteAddProject: 'Ajouter un projet sur une autre machine',
        remoteDeleteProject: 'Supprimer le projet',
        remoteDeviceChip: 'Appareil',
        remoteDeviceThisMachine: 'Cette machine',
        remoteDeviceBack: 'Tous les appareils',
        remoteDeviceNoProjects: 'Aucun projet sur cette machine pour le moment',
        remoteDeviceStarting: 'Démarrage…',
        remoteDeviceFailed: 'Impossible de démarrer la session',
        remoteDeviceUnreachable: 'Cette machine est inaccessible',
        remoteDeviceCreated: 'Session démarrée sur {name}',
        newSession: 'Nouvelle session',
        chooseDeviceProject: 'Choisir un appareil et un projet',
        project: 'Projet',
        chooseProject: 'Choisir un projet',
        deviceHint: 'Choisissez l’appareil sur lequel exécuter la session, puis sélectionnez un projet sur cet appareil.',
        remoteOpening: 'Ouverture de la session…',
        remoteOpen: 'Ouvrir la session',
        retry: 'Réessayer',
        remoteDisconnected: 'L’appareil s’est déconnecté. La session se rouvrira dès que la connexion sera rétablie.',
        remoteStreamReconnecting: 'Reconnexion à la session…',
        rename: 'Renommer',
        renameTitle: 'Nom de la session',
        save: 'Enregistrer',
        fork: 'Créer une branche de la session',
        archive: 'Archiver',
        copyId: 'Copier l’ID de session',
        copyDone: 'ID de session copié.',
        close: 'Fermer',
        localNoProjects: 'Ajoutez un projet pour démarrer une session.',
        remoteChoose: 'Ouvrir',
        remotePath: 'Modifier le chemin',
        remoteHome: 'Dossier personnel',
        projectFolderTitle: 'Choisir le dossier de l’espace de travail',
        folderName: 'Nom du dossier',
        remoteShowHidden: 'Afficher les dossiers cachés',
        remoteTruncated: 'Il y a trop de dossiers à afficher. Filtrez la liste ou saisissez un chemin.',
        remoteEmptyLevel: 'Aucun dossier ici',
        remoteLoading: 'Chargement…',
        remoteNewFolder: 'Nouveau dossier',
        remoteCreate: 'Créer',
        remoteCancel: 'Annuler',
        remoteWorking: 'Traitement…',
        remoteDeleteTitle: 'Supprimer le projet',
        remoteDeleteBody: 'Cette action est irréversible. Le dossier restera sur la machine.',
        remoteDeleteMachine: 'Machine',
        remoteDeletePath: 'Dossier',
        remoteDeleteSessions: 'Sessions',
        remoteDeleteCount: '{n}',
        remoteDeleteConfirm: 'Supprimer le projet',
      },
      de: {
        enable: 'Session Harbor verwenden',
        native: 'Native Seitenleiste verwenden',
        nativeShort: 'Native Leiste verwenden',
        sessions: 'Sitzungen',
        viewOptions: 'Ansichtsoptionen',
        addWorkspace: 'Arbeitsbereich hinzufügen',
        pinned: 'Angeheftet',
        active: 'Aktiv',
        working: 'In Arbeit',
        settled: 'Abgeschlossen',
        pin: 'Anheften',
        unpin: 'Lösen',
        settle: 'Als abgeschlossen markieren',
        unsettle: 'Reaktivieren',
        untitled: 'Sitzung ohne Titel',
        empty: 'Keine Sitzungen',
        loading: 'Sitzungen werden geladen…',
        syncing: 'Sitzungsgruppierung konnte nicht synchronisiert werden. Neuer Versuch…',
        actionFailed: 'Aktion fehlgeschlagen. Prüfen Sie den aktuellen Status und versuchen Sie es erneut.',
        openFailed: 'Die Sitzung konnte nicht geöffnet werden.',
        sessionInUse: 'Diese Sitzung wird in einem anderen Fenster oder Terminal verwendet. Schließe sie dort und versuche es erneut.',
        expand: 'Seitenleiste öffnen',
        menuDone: 'Sitzung als abgeschlossen markiert.',
        menuRestored: 'Sitzung reaktiviert.',
        more: 'Sitzungsaktionen',
        timeNow: 'jetzt',
        timeMinutes: '{n} min',
        timeHours: '{n} h',
        timeDays: '{n} Tg.',
        timeMonths: '{n} Mon.',
        timeYears: '{n} J.',
        statusOngoing: 'In Arbeit',
        statusWarning: 'Wartet auf Sie',
        statusDone: 'Fertig',
        waitingCount: '{n} ausstehend',
        remoteOn: 'Auf {name}',
        remotePickMachine: 'Rechner',
        remoteError: 'Entfernter Rechner konnte nicht synchronisiert werden. Neuer Versuch…',
        remoteUnknown: 'Unbekannter Status',
        remoteOfflineNote: 'Keine Antwort von {name}. Der letzte synchronisierte Stand wird angezeigt.',
        remoteReady: 'Verbunden',
        remoteConnecting: 'Verbindungsaufbau',
        remoteStale: 'Veraltet',
        remoteDown: 'Offline',
        remoteIncompatible: 'Inkompatible Version der Sitzungsgruppierung',
        remoteAddProject: 'Projekt auf anderem Rechner hinzufügen',
        remoteDeleteProject: 'Projekt löschen',
        remoteDeviceChip: 'Gerät',
        remoteDeviceThisMachine: 'Dieser Rechner',
        remoteDeviceBack: 'Alle Geräte',
        remoteDeviceNoProjects: 'Noch keine Projekte auf diesem Rechner',
        remoteDeviceStarting: 'Wird gestartet…',
        remoteDeviceFailed: 'Die Sitzung konnte nicht gestartet werden',
        remoteDeviceUnreachable: 'Der Rechner ist nicht erreichbar',
        remoteDeviceCreated: 'Sitzung auf {name} gestartet',
        newSession: 'Neue Sitzung',
        chooseDeviceProject: 'Gerät und Projekt auswählen',
        project: 'Projekt',
        chooseProject: 'Projekt auswählen',
        deviceHint: 'Wählen Sie das Gerät für die Sitzung und anschließend ein Projekt auf diesem Gerät aus.',
        remoteOpening: 'Sitzung wird geöffnet…',
        remoteOpen: 'Sitzung öffnen',
        retry: 'Erneut versuchen',
        remoteDisconnected: 'Die Verbindung zum Gerät wurde getrennt. Sobald sie wiederhergestellt ist, öffnet sich die Sitzung erneut.',
        remoteStreamReconnecting: 'Verbindung zur Sitzung wird wiederhergestellt…',
        rename: 'Umbenennen',
        renameTitle: 'Sitzungsname',
        save: 'Speichern',
        fork: 'Sitzung abzweigen',
        archive: 'Archivieren',
        copyId: 'Sitzungs-ID kopieren',
        copyDone: 'Sitzungs-ID kopiert.',
        close: 'Schließen',
        localNoProjects: 'Fügen Sie ein Projekt hinzu, um eine Sitzung zu starten.',
        remoteChoose: 'Öffnen',
        remotePath: 'Pfad bearbeiten',
        remoteHome: 'Home-Verzeichnis',
        projectFolderTitle: 'Ordner für den Arbeitsbereich auswählen',
        folderName: 'Ordnername',
        remoteShowHidden: 'Versteckte Ordner anzeigen',
        remoteTruncated: 'Zu viele Ordner für die Anzeige. Filtern Sie die Liste oder geben Sie einen Pfad ein.',
        remoteEmptyLevel: 'Keine Ordner vorhanden',
        remoteLoading: 'Laden…',
        remoteNewFolder: 'Neuer Ordner',
        remoteCreate: 'Erstellen',
        remoteCancel: 'Abbrechen',
        remoteWorking: 'Wird verarbeitet…',
        remoteDeleteTitle: 'Projekt löschen',
        remoteDeleteBody: 'Dieser Vorgang kann nicht rückgängig gemacht werden. Der Ordner bleibt auf dem Rechner erhalten.',
        remoteDeleteMachine: 'Rechner',
        remoteDeletePath: 'Ordner',
        remoteDeleteSessions: 'Sitzungen',
        remoteDeleteCount: '{n}',
        remoteDeleteConfirm: 'Projekt löschen',
      },
      ru: {
        enable: 'Переключиться на Session Harbor',
        native: 'Переключиться на стандартную боковую панель',
        nativeShort: 'Стандартная панель',
        sessions: 'Сеансы',
        viewOptions: 'Параметры вида',
        addWorkspace: 'Добавить рабочую область',
        pinned: 'Закреплённые',
        active: 'Активные',
        working: 'В работе',
        settled: 'Завершённые',
        pin: 'Закрепить',
        unpin: 'Открепить',
        settle: 'Отметить как завершённый',
        unsettle: 'Активировать снова',
        untitled: 'Сеанс без названия',
        empty: 'Нет сеансов',
        loading: 'Загрузка сеансов…',
        syncing: 'Не удалось синхронизировать группы сеансов. Повторная попытка…',
        actionFailed: 'Не удалось выполнить действие. Проверьте текущее состояние и повторите попытку.',
        openFailed: 'Не удалось открыть сеанс.',
        sessionInUse: 'Сеанс используется в другом окне или терминале. Закройте его там и повторите попытку.',
        expand: 'Открыть боковую панель',
        menuDone: 'Сеанс отмечен как завершённый.',
        menuRestored: 'Сеанс снова активен.',
        more: 'Действия с сеансом',
        timeNow: 'только что',
        timeMinutes: '{n} мин',
        timeHours: '{n} ч',
        timeDays: '{n} дн.',
        timeMonths: '{n} мес.',
        timeYears: '{n} г.',
        statusOngoing: 'В работе',
        statusWarning: 'Ожидает вашего действия',
        statusDone: 'Работа завершена',
        waitingCount: '{n} в ожидании',
        remoteOn: 'На устройстве {name}',
        remotePickMachine: 'Устройство',
        remoteError: 'Не удалось синхронизировать удалённые устройства. Повторная попытка…',
        remoteUnknown: 'Состояние неизвестно',
        remoteOfflineNote: 'Нет ответа от {name}. Показаны данные последней синхронизации.',
        remoteReady: 'Подключено',
        remoteConnecting: 'Подключение',
        remoteStale: 'Данные устарели',
        remoteDown: 'Не в сети',
        remoteIncompatible: 'Версии группировки сеансов не совпадают',
        remoteAddProject: 'Добавить проект на другом устройстве',
        remoteDeleteProject: 'Удалить проект',
        remoteDeviceChip: 'Устройство',
        remoteDeviceThisMachine: 'Это устройство',
        remoteDeviceBack: 'Все устройства',
        remoteDeviceNoProjects: 'На этом устройстве пока нет проектов',
        remoteDeviceStarting: 'Создание сеанса…',
        remoteDeviceFailed: 'Не удалось начать сеанс',
        remoteDeviceUnreachable: 'Устройство недоступно',
        remoteDeviceCreated: 'Сеанс запущен на устройстве {name}',
        newSession: 'Новый сеанс',
        chooseDeviceProject: 'Выберите устройство и проект',
        project: 'Проект',
        chooseProject: 'Выбрать проект',
        deviceHint: 'Выберите устройство для запуска сеанса, затем выберите проект на этом устройстве.',
        remoteOpening: 'Открытие сеанса…',
        remoteOpen: 'Открыть сеанс',
        retry: 'Повторить',
        remoteDisconnected: 'Связь с устройством прервалась. Сеанс откроется после восстановления подключения.',
        remoteStreamReconnecting: 'Повторное подключение к сеансу…',
        rename: 'Переименовать',
        renameTitle: 'Название сеанса',
        save: 'Сохранить',
        fork: 'Создать ветку сеанса',
        archive: 'Архивировать',
        copyId: 'Копировать ID сеанса',
        copyDone: 'ID сеанса скопирован.',
        close: 'Закрыть',
        localNoProjects: 'Добавьте проект, чтобы начать сеанс.',
        remoteChoose: 'Открыть',
        remotePath: 'Редактировать путь',
        remoteHome: 'Домашняя папка',
        projectFolderTitle: 'Выберите папку рабочей области',
        folderName: 'Имя папки',
        remoteShowHidden: 'Показать скрытые папки',
        remoteTruncated: 'Слишком много папок. Отфильтруйте список или введите путь.',
        remoteEmptyLevel: 'Здесь нет папок',
        remoteLoading: 'Загрузка…',
        remoteNewFolder: 'Новая папка',
        remoteCreate: 'Создать',
        remoteCancel: 'Отмена',
        remoteWorking: 'Выполняется…',
        remoteDeleteTitle: 'Удалить проект',
        remoteDeleteBody: 'Это действие нельзя отменить. Папка останется на устройстве.',
        remoteDeleteMachine: 'Устройство',
        remoteDeletePath: 'Папка',
        remoteDeleteSessions: 'Сеансы',
        remoteDeleteCount: '{n}',
        remoteDeleteConfirm: 'Удалить проект',
      },
      pt: {
        enable: 'Usar o Session Harbor',
        native: 'Usar a barra lateral padrão',
        nativeShort: 'Usar barra padrão',
        sessions: 'Sessões',
        viewOptions: 'Opções de visualização',
        addWorkspace: 'Adicionar espaço de trabalho',
        pinned: 'Fixadas',
        active: 'Ativas',
        working: 'Em andamento',
        settled: 'Concluídas',
        pin: 'Fixar',
        unpin: 'Desafixar',
        settle: 'Marcar como concluída',
        unsettle: 'Reativar',
        untitled: 'Sessão sem título',
        empty: 'Nenhuma sessão',
        loading: 'Carregando sessões…',
        syncing: 'Falha ao sincronizar os grupos de sessões. Tentando novamente…',
        actionFailed: 'A ação falhou. Verifique o estado atual e tente novamente.',
        openFailed: 'Não foi possível abrir a sessão.',
        sessionInUse: 'Esta sessão está em uso em outra janela ou terminal. Feche-a lá e tente novamente.',
        expand: 'Abrir barra lateral',
        menuDone: 'Sessão marcada como concluída.',
        menuRestored: 'Sessão reativada.',
        more: 'Ações da sessão',
        timeNow: 'agora',
        timeMinutes: '{n} min',
        timeHours: '{n} h',
        timeDays: '{n} d',
        timeMonths: '{n} mes.',
        timeYears: '{n} a',
        statusOngoing: 'Em andamento',
        statusWarning: 'Aguardando sua ação',
        statusDone: 'Finalizada',
        waitingCount: '{n} em espera',
        remoteOn: 'Em {name}',
        remotePickMachine: 'Máquina',
        remoteError: 'Falha ao sincronizar as máquinas remotas. Tentando novamente…',
        remoteUnknown: 'Estado desconhecido',
        remoteOfflineNote: 'Sem resposta de {name}. Exibindo os dados da última sincronização.',
        remoteReady: 'Conectada',
        remoteConnecting: 'Conectando',
        remoteStale: 'Dados desatualizados',
        remoteDown: 'Offline',
        remoteIncompatible: 'Versões incompatíveis do agrupamento de sessões',
        remoteAddProject: 'Adicionar projeto em outra máquina',
        remoteDeleteProject: 'Excluir projeto',
        remoteDeviceChip: 'Dispositivo',
        remoteDeviceThisMachine: 'Esta máquina',
        remoteDeviceBack: 'Todos os dispositivos',
        remoteDeviceNoProjects: 'Ainda não há projetos nessa máquina',
        remoteDeviceStarting: 'Criando sessão…',
        remoteDeviceFailed: 'Não foi possível iniciar a sessão',
        remoteDeviceUnreachable: 'Essa máquina está inacessível',
        remoteDeviceCreated: 'Sessão iniciada em {name}',
        newSession: 'Nova sessão',
        chooseDeviceProject: 'Escolha um dispositivo e um projeto',
        project: 'Projeto',
        chooseProject: 'Escolher projeto',
        deviceHint: 'Escolha o dispositivo em que a sessão será executada e selecione um projeto nele.',
        remoteOpening: 'Abrindo sessão…',
        remoteOpen: 'Abrir sessão',
        retry: 'Tentar novamente',
        remoteDisconnected: 'O dispositivo foi desconectado. A sessão será reaberta quando a conexão voltar.',
        remoteStreamReconnecting: 'Reconectando à sessão…',
        rename: 'Renomear',
        renameTitle: 'Nome da sessão',
        save: 'Salvar',
        fork: 'Ramificar sessão',
        archive: 'Arquivar',
        copyId: 'Copiar ID da sessão',
        copyDone: 'ID da sessão copiado.',
        close: 'Fechar',
        localNoProjects: 'Adicione um projeto para iniciar uma sessão.',
        remoteChoose: 'Abrir',
        remotePath: 'Editar caminho',
        remoteHome: 'Pasta pessoal',
        projectFolderTitle: 'Selecionar pasta do espaço de trabalho',
        folderName: 'Nome da pasta',
        remoteShowHidden: 'Mostrar pastas ocultas',
        remoteTruncated: 'Há pastas demais para listar. Filtre a lista ou digite um caminho.',
        remoteEmptyLevel: 'Nenhuma pasta aqui',
        remoteLoading: 'Carregando…',
        remoteNewFolder: 'Nova pasta',
        remoteCreate: 'Criar',
        remoteCancel: 'Cancelar',
        remoteWorking: 'Processando…',
        remoteDeleteTitle: 'Excluir projeto',
        remoteDeleteBody: 'Esta ação não pode ser desfeita. A pasta permanecerá na máquina.',
        remoteDeleteMachine: 'Máquina',
        remoteDeletePath: 'Pasta',
        remoteDeleteSessions: 'Sessões',
        remoteDeleteCount: '{n}',
        remoteDeleteConfirm: 'Excluir projeto',
      },
      ['z' + 'h']: {
        enable: '切换至 Session Harbor', native: '切换至原生侧栏', nativeShort: '切换至原生',
        sessions: '会话',
        viewOptions: '视图选项', addWorkspace: '添加工作区',
        pinned: '已置顶', active: '活跃', working: '工作中', settled: '已完成',
        pin: '置顶', unpin: '取消置顶', settle: '完成', unsettle: '重新激活', untitled: '未命名会话',
        empty: '暂无会话', loading: '正在加载会话…', syncing: '无法同步会话状态，正在重试…',
        actionFailed: '操作失败，请检查当前状态后重试。', openFailed: '无法打开会话。',
        sessionInUse: '此会话正在其他窗口或终端中使用。关闭后可重试。',
        expand: '展开侧边栏',
        menuDone: '会话已标记为完成。', menuRestored: '会话已重新激活。', more: '会话操作',
        timeNow: '刚刚', timeMinutes: '{n}分钟', timeHours: '{n}小时', timeDays: '{n}天', timeMonths: '{n}个月', timeYears: '{n}年',
        statusOngoing: '工作中', statusWarning: '等待你操作', statusDone: '已完成', waitingCount: '{n} 条待操作',
        remoteOn: '在 {name} 上', remotePickMachine: '机器', remoteError: '无法同步远程机器，正在重试…', remoteUnknown: '状态未知',
        remoteOfflineNote: '{name} 未响应，显示最后一次同步',
        remoteReady: '已连接', remoteConnecting: '连接中', remoteStale: '数据已过期', remoteDown: '离线', remoteIncompatible: '会话分组版本不匹配',

        remoteAddProject: '在其他机器上添加项目', remoteDeleteProject: '删除项目',
        remoteDeviceChip: '设备', remoteDeviceThisMachine: '本机', remoteDeviceBack: '全部设备',
        remoteDeviceNoProjects: '那台机器上还没有项目', remoteDeviceStarting: '正在新建…',
        remoteDeviceFailed: '没能在那个项目里新建会话', remoteDeviceUnreachable: '那台机器现在连不上',
        remoteDeviceCreated: '已在 {name} 上新建会话',
        newSession: '新会话', chooseDeviceProject: '选择设备和项目', project: '项目', chooseProject: '选择项目',
        deviceHint: '先选择会话运行的设备，再选择该设备上的项目。',
        remoteOpening: '正在打开会话…', remoteOpen: '打开会话', retry: '重试',
        remoteDisconnected: '设备已断开，重新连接后将打开此会话。',
        remoteStreamReconnecting: '正在重新连接会话…',
        rename: '重命名', renameTitle: '会话名称', save: '保存', fork: '分叉会话', archive: '归档', copyId: '复制会话 ID',
        copyDone: '已复制会话 ID。', close: '关闭', localNoProjects: '添加项目后即可开始会话。',
        remoteChoose: '打开', remotePath: '编辑路径', remoteHome: '主目录', projectFolderTitle: '选择工作区目录', folderName: '文件夹名称',
        remoteShowHidden: '显示隐藏文件夹', remoteTruncated: '该层目录过多，请用输入框过滤或直接输入路径。', remoteEmptyLevel: '这里没有子目录', remoteLoading: '正在加载…',
        remoteNewFolder: '新建文件夹', remoteCreate: '创建', remoteCancel: '取消', remoteWorking: '处理中…',
        remoteDeleteTitle: '删除项目', remoteDeleteBody: '此操作不可撤销。机器上的目录本身不会被删除。',
        remoteDeleteMachine: '机器', remoteDeletePath: '目录', remoteDeleteSessions: '会话数', remoteDeleteCount: '{n}', remoteDeleteConfirm: '删除项目'
      }
    };
    const pickerCss = `
      .t3-picker-trigger{display:flex;width:100%;justify-content:flex-start;gap:6px;min-width:0}
      .t3-picker-trigger.t3-picker-compact{width:auto;max-width:min(100%,360px);min-height:28px;padding-inline:8px}
      .t3-picker-trigger svg{flex:none}
      .t3-picker-text{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:start}
`;
    const css = `
      .t3-sidebar{display:flex;flex-direction:column;min-height:0;flex:1;color:var(--dsw-alias-label-primary);font-size:13px}
      .t3-sidebar[data-expanded=true]{flex:none;height:var(--t3-fill,100cqh);min-height:min(160px,100cqh)}
      .t3-header{flex:none;display:flex;align-items:center;height:36px;box-sizing:border-box;padding:0 6px 0 10px;margin-bottom:4px;color:var(--dsw-alias-label-tertiary);line-height:20px}
      .t3-btn{border:0;background:transparent;color:inherit;font:inherit;cursor:pointer;border-radius:5px;padding:5px}
      .t3-btn:hover,.t3-btn:focus-visible{background:var(--dsw-alias-bg-layer-2)}
      .t3-btn:disabled{opacity:.45;cursor:default}
      .t3-list-frame{flex:1;min-height:0;container:t3-list-height / size}
      .t3-list{display:flex;flex-direction:column;height:100%;box-sizing:border-box;padding:0 6px 10px;overflow:auto}
      .t3-group{display:flex;flex-direction:column;flex:0 1 auto;min-height:26px;margin-top:7px}
      /* Active takes the spare space beneath its rows, keeping Working and
         Settled at the bottom whether or not Pinned has any rows. */
      .t3-group[data-group=active]{flex-grow:1}
      .t3-group[data-has-rows=true]{min-height:78px}
      /* Let Working fit its rows even when Active is long. Cap its height so
         a busy list still leaves room for the other sections. */
      .t3-group[data-group=working]{flex-shrink:0;max-height:40cqh}
      .t3-rows{min-height:0;overflow:auto;scrollbar-gutter:stable}
      @container t3-list-height (height < 350px){
        .t3-list{scrollbar-gutter:stable}
        .t3-group{flex-shrink:0}
        .t3-group[data-group=working]{max-height:none}
        .t3-rows{overflow:visible;scrollbar-gutter:auto}
      }
      .t3-heading{display:flex;flex:none;min-height:26px;width:100%;align-items:center;gap:6px;text-align:left;color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:600}
      .t3-count{flex:none;margin-left:auto;font-weight:400;color:var(--dsw-alias-label-caption)}
      .t3-waiting{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:400;color:var(--dsw-alias-label-secondary)}
      .t3-message{padding:8px 12px;color:var(--dsw-alias-label-secondary);font-size:12px}
      .t3-btn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
      /* Session rows show the workspace and optional host on the first line,
         with the title and time on the second line. */
      .t3-row{position:relative;display:flex;flex-direction:column;gap:2px;box-sizing:border-box;min-width:0;margin:2px 0;padding:6px 8px;border-radius:8px;cursor:pointer;user-select:none;color:var(--dsw-alias-label-primary);outline:none}
      .t3-row:hover,.t3-row:focus-within{background:var(--dsw-alias-interactive-bg-hover)}
      .t3-row[data-current=true]{background:var(--dsw-alias-interactive-bg-active)}
      /* A live run is named by its accent label alone. Background stays reserved
         for hover, keyboard focus and the current session, so a running row that
         is neither stays flat like every other unselected row. */
      .t3-top{display:flex;align-items:center;gap:6px;min-width:0;height:16px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary)}
      .t3-pin{display:inline-flex;flex:none;color:var(--dsw-alias-label-caption)}
      .t3-proj{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .t3-line{display:flex;align-items:center;gap:6px;min-width:0}
      .t3-open{flex:1;min-width:0;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:0;border:0;background:transparent;color:inherit;font:inherit;font-size:13px;font-weight:500;line-height:18px;cursor:pointer}
      .t3-open:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px;border-radius:4px}
      .t3-status{display:inline-flex;flex:none;align-items:center}
      .t3-dot{position:relative;width:10px;height:10px}
      .t3-dot::after{content:'';position:absolute;inset:20%;border-radius:50%}
      .t3-dot[data-state=done]::after{background:var(--dsw-alias-state-success-primary)}
      .t3-dot[data-state=warning]::after{background:var(--dsw-alias-state-warn-primary)}
      .t3-spinner{width:12px;height:12px;color:var(--dsw-alias-label-tertiary);animation:t3-spin 1.5s linear infinite}
      .t3-live .t3-spinner{color:currentColor}
      .t3-spinner circle{fill:none;stroke:currentColor;stroke-width:2.4;stroke-linecap:round}
      .t3-spinner .t3-track{opacity:.25}
      .t3-spinner .t3-arc{stroke-dasharray:20 150}
      @keyframes t3-spin{to{transform:rotate(360deg)}}
      @media (prefers-reduced-motion: reduce){.t3-spinner{animation:none}}
      .t3-slot{position:relative;flex:none;display:inline-flex;align-items:center;justify-content:flex-end;height:18px;margin-left:auto}
      .t3-time{flex:none;font-size:11px;line-height:16px;color:var(--dsw-alias-label-caption);font-variant-numeric:tabular-nums;white-space:nowrap}
      .t3-slot[data-host]{max-width:50%;gap:4px}
      .t3-slot[data-host] .t3-actions{flex:none}
      .t3-row:is(:hover,:focus-within,:has([aria-expanded=true])) .t3-slot[data-host]{max-width:70%}
      .t3-host{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-caption)}
      /* A running session shows its status and elapsed time in the time slot. */
      .t3-live{display:inline-flex;align-items:center;gap:4px;color:var(--dsw-alias-state-business-primary);font-weight:500}
      .t3-actions{position:absolute;right:0;top:0;display:inline-flex;align-items:center;gap:2px;opacity:0;pointer-events:none;transition:opacity .12s ease}
      /* 18px tall so the hover action strip never grows the slot it replaces. */
      .t3-icon-button{display:inline-flex;align-items:center;justify-content:center;width:20px;height:18px;padding:0;border:0;background:transparent;border-radius:5px;color:var(--dsw-alias-label-tertiary);cursor:pointer}
      .t3-icon-button:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2)}
      .t3-icon-button:disabled{opacity:.45;cursor:default}
      .t3-icon-button[data-pinned=true]{color:var(--dsw-alias-brand-primary)}
      .t3-row:hover .t3-actions,.t3-row:focus-within .t3-actions,.t3-row:has([aria-expanded=true]) .t3-actions{position:static;opacity:1;pointer-events:auto}
      .t3-row:hover .t3-pin,.t3-row:focus-within .t3-pin,.t3-row:has([aria-expanded=true]) .t3-pin{display:none}
      .t3-footer{display:inline-flex;align-items:center;gap:8px;flex:1 1 0;width:100%;min-width:0;height:32px;padding:0 10px;overflow:hidden;color:var(--dsw-alias-label-primary);font-size:13px;text-align:left;white-space:nowrap}
      .t3-footer svg{flex:none}
      .t3-footer[data-wide=false]{flex:none;width:32px;justify-content:center;padding:0}
      .t3-footer-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .t3-row[data-open-disabled=true]{cursor:default}
      .t3-hero-seat{display:contents}
      .t3-hero-pickers{display:flex;align-items:center;min-width:0;gap:2px}
      ${pickerCss}
      .t3-hero-picker-status{min-width:0;margin-inline-start:6px;color:var(--dsw-alias-label-secondary);font-size:12px;overflow-wrap:anywhere}
      .t3-hero-seat:has([data-staged=true]) ~ *{display:none}
      [data-composer-card][data-t3-device-inert]{opacity:.55}
      .t3-native-portals{position:fixed;inset:0;z-index:100;pointer-events:none}.t3-native-portals>*{pointer-events:auto}
      .t3-device-main,.t3-device-main-content,.t3-native-region,.t3-native-body,.t3-native-conversation{display:flex;flex:1;min-height:0;min-width:0;overflow:hidden}
      .t3-device-main,.t3-device-main-content,.t3-native-region,.t3-native-conversation{flex-direction:column}
      .t3-native-body{flex-direction:row}
      .t3-native-right{display:flex;flex-direction:column;flex:none;min-width:0;min-height:0;overflow:hidden}
      .t3-device-reconnecting{flex:none;padding:8px 16px;color:var(--dsw-alias-label-secondary);font-size:13px}
      .t3-new-session{display:flex;flex:1;min-height:0;overflow:auto;flex-direction:column;justify-content:center;align-items:center;padding:24px;color:var(--dsw-alias-label-primary)}
      .t3-new-card{display:flex;flex-direction:column;gap:18px;width:min(640px,100%)}
      .t3-new-card h1{font-size:20px;line-height:1.4;font-weight:600;margin:0}
      .t3-new-hint{margin:0;font-size:13px;line-height:1.6;color:var(--dsw-alias-label-secondary)}
      .t3-new-fields{display:flex;gap:12px;flex-wrap:wrap}
      .t3-new-field{display:flex;flex-direction:column;gap:7px;flex:1;min-width:180px;font-size:12px;color:var(--dsw-alias-label-secondary)}
      .t3-new-actions{display:flex;align-items:center;gap:10px}
      .t3-device-error{display:flex;flex-direction:column;align-items:flex-start;gap:12px;padding:24px;font-size:13px;color:var(--dsw-alias-label-secondary)}
      .t3-device-error p{margin:0}
      .t3-rename-form{display:flex;flex-direction:column;gap:12px}
      .t3-folder-dialog[role=dialog]{display:flex;flex-direction:column;box-sizing:border-box;width:min(680px,calc(100vw - 32px));height:min(500px,calc(100dvh - 32px));max-width:none;padding:0;overflow:hidden}
      .t3-folder-scope{display:contents}
      .t3-folder-head{display:grid;gap:8px;flex:none;padding:16px 24px 8px;border-bottom:.5px solid var(--dsw-alias-border-l3)}
      .t3-folder-title{margin:0;font-size:16px;line-height:24px;font-weight:510}
      .t3-folder-heading,.t3-folder-path,.t3-folder-footer{display:flex;align-items:center;gap:8px;min-width:0}
      .t3-folder-heading>.t3-folder-title,.t3-folder-gap{flex:1}
      .t3-folder-heading>.t3-picker-trigger{max-width:45%}
      .t3-folder-machine{display:inline-flex;align-items:center;gap:4px;max-width:45%;color:var(--dsw-alias-label-secondary);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .t3-folder-path{min-height:26px;border:1px solid transparent;border-radius:var(--dsw-radius-sm)}
      .t3-folder-crumbs{display:flex;align-items:center;gap:4px;min-width:0;overflow-x:auto;scrollbar-width:none;color:var(--dsw-alias-label-secondary)}
      .t3-folder-crumbs button{flex:none;padding:2px 4px;border:0;border-radius:var(--dsw-radius-sm);background:transparent;color:inherit;font:inherit;font-size:13px;cursor:pointer}
      .t3-folder-crumbs button[aria-current=true]{color:var(--dsw-alias-label-primary)}
      .t3-folder-edit{display:flex;justify-content:flex-end;flex:1;min-width:26px;color:var(--dsw-alias-label-secondary)}
      .t3-folder-path:has(input)>span{flex:1;min-width:0}
      .t3-folder-columns{display:flex;flex:1;min-height:0;overflow-x:auto;scrollbar-width:none}
      .t3-folder-column{flex:1 0 min(256px,100%);min-height:0;box-sizing:border-box;overflow:auto;padding:8px 12px}
      .t3-folder-column+.t3-folder-column{border-inline-start:.5px solid var(--dsw-alias-border-l3)}
      .t3-folder-row{display:flex;align-items:center;gap:8px;width:100%;min-height:30px;padding:0 8px;border:0;border-radius:var(--dsw-radius-sm);background:transparent;color:inherit;font:inherit;font-size:13px;font-weight:500;text-align:start;cursor:pointer}
      .t3-folder-row svg{flex:none}
      .t3-folder-row span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .t3-folder-row[aria-pressed=true],.t3-folder-row:hover,.t3-folder-crumbs button:hover{background:var(--dsw-alias-interactive-bg-hover)}
      .t3-folder-footer{flex-wrap:wrap;flex:none;padding:16px 24px;border-top:.5px solid var(--dsw-alias-border-l3);color:var(--dsw-alias-label-secondary)}
      .t3-folder-action{min-width:72px}
      .t3-folder-status{padding:4px 24px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;overflow-wrap:anywhere}
      .t3-folder-status[role=alert]{color:var(--dsw-alias-state-error-primary)}
    `;
    function ViewOptionsIcon({ size = 16 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeLinecap: 'round', strokeWidth: 1, 'aria-hidden': true },
        h('path', { d: 'M2.3 5h5.85M12.05 5h1.65' }),
        h('circle', { cx: 9.95, cy: 5, r: 1.45 }),
        h('path', { d: 'M2.3 11h1.65M7.85 11h5.85' }),
        h('circle', { cx: 5.75, cy: 11, r: 1.45 }));
    }
    function PinIcon({ filled = false, size = 15 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
        h('path', { d: 'M16 4v5l3 3v2H5v-2l3-3V4', fill: filled ? 'currentColor' : 'none' }),
        h('path', { d: 'M6 4h12M12 14v7' }));
    }
    function SwitchSidebarIcon() {
      return h('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
        h('rect', { x: 3, y: 4, width: 18, height: 16, rx: 2 }), h('path', { d: 'M9 4v16' }));
    }
    function SettledIcon({ restored = false }) {
      return h('svg', { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
        h('path', { d: restored ? 'M4 10a8 8 0 1 1 2.4 6.7M4 5v5h5' : 'M5 12l4.3 4.3L19 6.6' }));
    }
    function StatusGlyph({ state }) {
      if (state === 'ongoing') return h('svg', { className: 't3-spinner', viewBox: '0 0 24 24', 'aria-hidden': true },
        h('circle', { className: 't3-track', cx: 12, cy: 12, r: 9.5 }),
        h('circle', { className: 't3-arc', cx: 12, cy: 12, r: 9.5 }));
      return h('span', { className: 't3-dot', 'data-state': state, 'aria-hidden': true });
    }
    // Same buckets as the native sidebar's relative time, so both surfaces name
    // one session's age identically; the words stay in this plugin's dictionary.
    const MINUTE = 60000, HOUR = 3600000, DAY = 86400000;
    function relativeUnit(at, now) {
      const diff = Math.max(0, now - at);
      if (!Number.isFinite(at) || diff < MINUTE) return ['now', 0];
      if (diff < HOUR) return ['minutes', Math.floor(diff / MINUTE)];
      if (diff < DAY) return ['hours', Math.floor(diff / HOUR)];
      if (diff < 30 * DAY) return ['days', Math.floor(diff / DAY)];
      if (diff < 365 * DAY) return ['months', Math.floor(diff / (30 * DAY))];
      return ['years', Math.floor(diff / (365 * DAY))];
    }
    function timeLabel(t, at, now) {
      const [unit, n] = relativeUnit(at, now);
      if (unit === 'now') return t('timeNow');
      return t('time' + unit[0].toUpperCase() + unit.slice(1)).replace('{n}', String(n));
    }
    /** Elapsed run time for the live label; the first minute shows the bare
       status so the row never reads "工作中 刚刚". */
    function workingDuration(t, since, now) {
      if (!Number.isFinite(since)) return null;
      const [unit, n] = relativeUnit(since, now);
      if (unit === 'now') return null;
      return t('time' + unit[0].toUpperCase() + unit.slice(1)).replace('{n}', String(n));
    }
    function pathLabel(value) {
      const parts = String(value || '').split(/[\\/]+/).filter(Boolean);
      return parts.length ? parts[parts.length - 1] : '';
    }
    /** Minute-aligned clock, so only the age labels need a fresh render each minute. */
    function useNowMinute() {
      const [now, setNow] = React.useState(() => Date.now());
      React.useEffect(() => {
        let timer;
        const arm = () => { timer = setTimeout(() => { setNow(Date.now()); arm(); }, 60000 - (Date.now() % 60000)); };
        arm();
        return () => clearTimeout(timer);
      }, []);
      return now;
    }
    function errorWithDetail(message, detail) {
      return detail && detail !== message ? `${message} ${detail}` : message;
    }

    function unwrap(result) {
      if (!result || result.ok !== true) throw Object.assign(new Error(result?.error?.message || 'RPC failed'), { code: result?.error?.code });
      return result.value;
    }
    function validRemoteSnapshot(value) {
      return !!value && typeof value.epoch === 'string' && Number.isSafeInteger(value.revision) && value.revision >= 0
        && ['targets', 'workspaces', 'sessions'].every(key => value[key] && typeof value[key] === 'object' && !Array.isArray(value[key]));
    }
    function validSnapshot(value) {
      return value && typeof value.epoch === 'string' && Number.isSafeInteger(value.revision) && value.revision >= 0 && value.placements && typeof value.placements === 'object' && !Array.isArray(value.placements);
    }
    /** Follows the remote-device mirror without blocking the local sidebar. */
    function useRemoteMachines(context) {
      const state = React.useSyncExternalStore(
        listener => { mirrorListeners.add(listener); return () => mirrorListeners.delete(listener); },
        () => mirrorState,
        () => mirrorState,
      );
      React.useEffect(() => {
        mirrorRefs += 1;
        if (mirrorRefs === 1) startMirror(context);
        return () => {
          mirrorRefs -= 1;
          if (mirrorRefs === 0) stopMirror();
        };
      }, [context]);
      return state;
    }

    /**
     * The mirror is read by more than one seat now — the sidebar shelves and the
     * new-session device chip — and each of them long-polls the same door. One loop
     * per page, reference counted, so two seats never hold two connections open.
     */
    let mirrorState = { snapshot: null, error: false };
    const mirrorListeners = new Set();
    let mirrorRefs = 0;
    let mirrorGeneration = 0;
    let mirrorTimer = null;
    let mirrorRequest = null;
    function publishMirror(next) {
      if (next.snapshot === mirrorState.snapshot && next.error === mirrorState.error) return;
      mirrorState = next;
      for (const listener of [...mirrorListeners]) listener();
    }
    function stopMirror() {
      mirrorGeneration += 1;
      clearTimeout(mirrorTimer);
      mirrorTimer = null;
      mirrorRequest?.abort();
      mirrorRequest = null;
    }
    function startMirror(context) {
      const generation = ++mirrorGeneration;
      let cursor = null;
      const step = async () => {
        if (generation !== mirrorGeneration) return;
        const active = new AbortController();
        mirrorRequest = active;
        try {
          const value = unwrap(await context.connection.rpc.call('/api', 't3-remote/snapshot', cursor || {}, active.signal));
          if (!validRemoteSnapshot(value)) throw new Error('Invalid remote snapshot');
          if (generation !== mirrorGeneration) return;
          cursor = { epoch: value.epoch, revision: value.revision };
          publishMirror({ snapshot: value, error: false });
          mirrorTimer = setTimeout(step, 500);
        } catch {
          if (generation !== mirrorGeneration) return;
          if (!active.signal.aborted) publishMirror({ ...mirrorState, error: true });
          cursor = null;
          mirrorTimer = setTimeout(step, active.signal.aborted ? 0 : 5000);
        }
      };
      step();
    }

    // A mirror written by an older or newer supervisor must not take the sidebar down
    // with it, so an unrecognised status is named rather than thrown.
    const REMOTE_STATUSES = new Set(['connecting', 'ready', 'stale', 'down', 'incompatible']);
    const remoteStatusKey = status => REMOTE_STATUSES.has(status)
      ? 'remote' + status[0].toUpperCase() + status.slice(1)
      : 'remoteUnknown';

    // T3 Code tells machines apart by the shape of the glyph (server / linux / laptop /
    // cloud …). We know far less about a machine over a tunnel, but the shape of its home
    // directory separates the three families that matter, and Linux and WSL share one
    // glyph there too.
    function MachineIcon({ kind = 'server', size = 13 }) {
      const parts = kind === 'windows'
        ? [h('rect', { x: 4, y: 4, width: 7, height: 7 }), h('rect', { x: 13, y: 4, width: 7, height: 7 }),
          h('rect', { x: 4, y: 13, width: 7, height: 7 }), h('rect', { x: 13, y: 13, width: 7, height: 7 })]
        : kind === 'macos'
          ? [h('rect', { x: 4, y: 5, width: 16, height: 11, rx: 1.5 }), h('path', { d: 'M2 19.5h20' })]
          : kind === 'linux'
            ? [h('rect', { x: 3, y: 4, width: 18, height: 16, rx: 2 }), h('path', { d: 'M7 9l3 3-3 3M13 15h4' })]
            : kind === 'wsl'
              // The same terminal, with the four-dot corner of the Windows flag: a Linux
              // prompt that lives inside a Windows box.
              ? [h('rect', { x: 3, y: 4, width: 18, height: 16, rx: 2 }), h('path', { d: 'M7 11l3 3-3 3M13 17h4' }),
                h('path', { d: 'M15.5 7h.01M18.5 7h.01M15.5 10h.01M18.5 10h.01' })]
            : [h('rect', { x: 3, y: 4, width: 18, height: 7, rx: 2 }), h('rect', { x: 3, y: 13, width: 18, height: 7, rx: 2 }),
              h('path', { d: 'M7 7.5h.01M7 16.5h.01' })];
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }, ...parts);
    }

    function MachineName({ machine, t }) {
      const where = t('remoteOn').replace('{name}', machine.label);
      const title = machine.status === 'ready' ? where : where + ' · ' + t(remoteStatusKey(machine.status));
      return h('span', { className: 't3-host', title }, machine.label);
    }

    function remoteTargetsOf(snapshot) {
      return Object.values(snapshot?.targets ?? {});
    }

    /** One door onto the machine's own write surface; the machine decides the rest. */
    async function remoteCall(endpoint, payload, signal) {
      return unwrap(await Sidebar.context.connection.rpc.call('/api', endpoint, payload, signal));
    }

    const DEVICE_PANEL = 't3-device-conversation';
    const NEW_PANEL = 't3-device-new';
    let pool = null;
    let poolLoading = null;
    let awaitingOpen = null;
    let runtimeClosed = false;
    let navigation = 0;
    const selectedDeviceKey = 'dsh.t3.selected-device-session';
    let restoreReference = null;
    try {
      const saved = JSON.parse(window.localStorage.getItem(selectedDeviceKey));
      if (saved && typeof saved.targetId === 'string' && /^[A-Za-z0-9-]{1,80}$/.test(saved.targetId)
        && (saved.sessionId === null || typeof saved.sessionId === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(saved.sessionId))) restoreReference = saved;
    } catch { /* unavailable or outdated browser state is not a navigation request */ }
    let restorePending = restoreReference !== null;
    let stopPool = () => {};
    let runtimeSnapshot = { pool: null, active: null, phase: 'idle', error: null, revision: 0 };
    const runtimeListeners = new Set();
    const runtimeSubscribe = listener => { runtimeListeners.add(listener); return () => runtimeListeners.delete(listener); };
    function publishRuntime(patch) {
      runtimeSnapshot = { ...runtimeSnapshot, ...patch, revision: runtimeSnapshot.revision + 1 };
      if (Object.hasOwn(patch, 'active') && !restorePending && !runtimeClosed) {
        try {
          if (patch.active) window.localStorage.setItem(selectedDeviceKey, JSON.stringify(patch.active));
          else window.localStorage.removeItem(selectedDeviceKey);
        } catch { /* the live selection still works when browser persistence is unavailable */ }
      }
      for (const listener of [...runtimeListeners]) listener();
    }
    function useDeviceRuntime() {
      return React.useSyncExternalStore(runtimeSubscribe, () => runtimeSnapshot, () => runtimeSnapshot);
    }
    const lastSessionKey = 'dsh.t3.last-new-session';
    let lastNewSession;
    function readLastNewSession() {
      try {
        const saved = JSON.parse(window.localStorage.getItem(lastSessionKey));
        if (saved && (saved.targetId === null || typeof saved.targetId === 'string' && /^[A-Za-z0-9-]{1,80}$/.test(saved.targetId))
          && typeof saved.workspaceId === 'string' && saved.workspaceId) return saved;
      } catch { /* invalid or unavailable browser storage */ }
      return lastNewSession;
    }
    function rememberNewSession(targetId, workspaceId) {
      if (runtimeClosed) return;
      lastNewSession = { targetId, workspaceId };
      try { window.localStorage.setItem(lastSessionKey, JSON.stringify(lastNewSession)); }
      catch { /* keep the choice within this tab if browser storage is unavailable */ }
    }
    function wrapWorkspaceMethod(service, method, wrap) {
      const original = service[method];
      if (typeof original !== 'function') return () => {};
      const descriptor = Object.getOwnPropertyDescriptor(service, method);
      const wrapped = wrap(original);
      service[method] = wrapped;
      return () => {
        if (Object.getOwnPropertyDescriptor(service, method)?.value !== wrapped) return;
        if (descriptor) Object.defineProperty(service, method, descriptor);
        else Reflect.deleteProperty(service, method);
      };
    }
    function observeWorkspaceStarts(service, targetId) {
      return wrapWorkspaceMethod(service, 'openWorkspace', original => async function(workspaceId, beforeOpen, options) {
        let selected = false;
        const result = await original.call(this, workspaceId, sessionId => {
          beforeOpen?.(sessionId);
          selected = true;
        }, options);
        if (selected) rememberNewSession(targetId, workspaceId);
        return result;
      });
    }
    let deviceChoice = { targetId: null, revision: 0 };
    const choiceListeners = new Set();
    const choiceSubscribe = listener => { choiceListeners.add(listener); return () => choiceListeners.delete(listener); };
    function pickDevice(targetId) {
      deviceChoice = { targetId: targetId ?? null, revision: deviceChoice.revision + 1 };
      for (const listener of [...choiceListeners]) listener();
    }
    function currentMachine(targetId) { return mirrorState.snapshot?.targets?.[targetId]; }
    function currentConnection(targetId) { return mirrorState.snapshot?.connections?.[targetId]; }
    function canOpenDevice(targetId) {
      const status = currentMachine(targetId)?.status;
      return !!currentConnection(targetId) && status !== 'down' && status !== 'connecting';
    }
    function canManageDevice(targetId) {
      const status = currentMachine(targetId)?.status;
      return !!currentConnection(targetId) && (status === 'ready' || status === 'incompatible');
    }
    function requireRemoteReady(targetId) {
      if (!canManageDevice(targetId)) {
        throw new Error(Sidebar.context.locale.bind(NS)('remoteDeviceUnreachable'));
      }
      return currentConnection(targetId);
    }
    function refreshMirror() { mirrorRequest?.abort(); }
    function deactivateDevice() {
      restorePending = false;
      navigation++;
      awaitingOpen = null;
      pool?.deactivate();
      publishRuntime({ active: null, phase: 'idle', error: null });
    }
    function chooseDeviceProject(targetId = null) {
      Sidebar.context.layout.selectPanel(NEW_PANEL);
      deactivateDevice();
      pickDevice(targetId);
    }
    function startLastNewSession() {
      const saved = readLastNewSession();
      if (!saved) return false;
      const { targetId, workspaceId } = saved;
      const context = Sidebar.context;
      if (targetId === null) {
        if (!context.workspaces.list.getSnapshot().items.some(project => project.workspaceId === workspaceId)) return false;
        context.uiWorkspace.startSession(workspaceId);
        return true;
      }
      if (!canManageDevice(targetId) || !Object.hasOwn(mirrorState.snapshot.workspaces, `${targetId}/${workspaceId}`)) return false;
      void createAndOpenDeviceSession(targetId, workspaceId).catch(error => {
        const title = context.locale.bind(NS)('remoteDeviceFailed');
        context.contextMenus.notify(errorWithDetail(title, error?.message), false);
      });
      return true;
    }
    async function devicePool() {
      if (pool) return pool;
      if (poolLoading) return poolLoading;
      const context = Sidebar.context;
      const operation = (async () => {
        const loaded = await require.async('./client.remote-runtime.js');
        if (runtimeClosed) throw new Error('The device workspace has closed');
        pool = loaded.createDeviceRuntimePool({
          context, React, platformRequire: require,
          describe: (targetId, { signal } = {}) => remoteCall('t3-remote/runtime', { targetId }, signal),
          onChooseDevice: chooseDeviceProject,
          startLastNewSession,
          observeWorkspaceStarts,
          installWorkspacePicker: installDeviceWorkspacePicker,
          installSessionOpenNotice(device) {
            const disposeLocale = device.locale.register(NS, dictionaries);
            const disposeNotice = installSessionOpenNotice(device);
            return () => { disposeNotice(); disposeLocale(); };
          },
          onStatusChange: () => publishRuntime({}),
        });
        stopPool = pool.state.subscribe(() => {
          const value = pool.state.getSnapshot();
          if (!runtimeSnapshot.active || runtimeSnapshot.phase === 'offline'
            || value.active?.targetId !== runtimeSnapshot.active.targetId
            || awaitingOpen && value.active !== awaitingOpen) {
            publishRuntime({});
            return;
          }
          publishRuntime({ ...value, pool });
        });
        publishRuntime({ pool });
        return pool;
      })();
      poolLoading = operation;
      try { return await operation; }
      finally { if (poolLoading === operation) poolLoading = null; }
    }
    async function openDeviceSession(reference, { reconnect = false, refresh = false } = {}) {
      if (reference.sessionId === null) { chooseDeviceProject(reference.targetId); return; }
      const layout = Sidebar.context.layout;
      if (reconnect && layout.panelInfo.getSnapshot().activePanelId !== DEVICE_PANEL) return;
      if (!reconnect) layout.selectPanel(DEVICE_PANEL);
      restorePending = false;
      const token = ++navigation;
      const connectionId = currentConnection(reference.targetId);
      if (!canOpenDevice(reference.targetId)) {
        awaitingOpen = null;
        pool?.deactivate();
        publishRuntime({ active: reference, phase: 'offline', error: null });
        return;
      }
      awaitingOpen = reference;
      publishRuntime({ active: reference, phase: 'loading', error: null });
      try {
        const next = await devicePool();
        if (runtimeClosed || token !== navigation) return;
        const opening = next.open(reference, { connectionId, refresh });
        awaitingOpen = null;
        await opening;
        if (token !== navigation) return;
        publishRuntime({});
      } catch (error) {
        if (token !== navigation || runtimeClosed) return;
        awaitingOpen = null;
        publishRuntime({ active: reference, phase: 'error', error: error?.message ?? String(error) });
        throw error;
      }
    }
    async function prepareRemoteNavigation(targetId, signal) {
      const connectionId = requireRemoteReady(targetId);
      const next = await devicePool();
      signal.throwIfAborted();
      const runtime = await next.ensure(targetId, { connectionId });
      signal.throwIfAborted();
      if (requireRemoteReady(targetId) !== connectionId) {
        throw new Error(Sidebar.context.locale.bind(NS)('remoteDeviceUnreachable'));
      }
      return { device: runtime.ctx, connectionId };
    }
    async function localDefaultPresetOn(device) {
      const local = Sidebar.context;
      try {
        const [configured, available] = await Promise.all([
          local.get('remote.agentPresets')?.list(), device.get('remote.agentPresets')?.list(),
        ]);
        const preferred = configured?.value?.presets.find(preset => preset.isDefault && preset.broken === undefined)?.id;
        if (preferred && available?.value?.presets.some(preset => preset.id === preferred && preset.broken === undefined)) return preferred;
      } catch { /* use the device's default if its presets cannot be checked */ }
    }
    async function createAndOpenDeviceSession(targetId, workspaceId, signal) {
      const navigation = Sidebar.context.layout.beginNavigation();
      const request = signal ? AbortSignal.any([navigation, signal]) : navigation;
      let session;
      try {
        const { device, connectionId } = await prepareRemoteNavigation(targetId, request);
        const agentPreset = await localDefaultPresetOn(device);
        request.throwIfAborted();
        if (requireRemoteReady(targetId) !== connectionId) {
          throw new Error(Sidebar.context.locale.bind(NS)('remoteDeviceUnreachable'));
        }
        ({ session } = await remoteCall('t3-remote/session-create', {
          targetId, workspaceId, ...(agentPreset === undefined ? {} : { agentPreset }),
        }, request));
      } catch (error) {
        if (request.aborted) return;
        throw error;
      }
      if (!session?.sessionId) throw new Error(Sidebar.context.locale.bind(NS)('remoteDeviceFailed'));
      rememberNewSession(targetId, workspaceId);
      refreshMirror();
      if (!request.aborted) await openDeviceSession({ targetId, sessionId: session.sessionId });
    }
    async function remoteSessionCommand(target, action, title, signal) {
      requireRemoteReady(target.targetId);
      const value = await remoteCall('t3-remote/session-command', {
        targetId: target.targetId, sessionId: target.sessionId, action,
        ...(title === undefined ? {} : { title }),
      }, signal);
      refreshMirror();
      return value;
    }
    function RuntimeConnections({ usePanelInfo }) {
      const activePanel = usePanelInfo(info => info.activePanelId);
      React.useEffect(() => {
        if (Sidebar.context.layout.panelInfo.getSnapshot().activePanelId !== DEVICE_PANEL && runtimeSnapshot.active) deactivateDevice();
      }, [activePanel]);
      const remote = useRemoteMachines(Sidebar.context);
      React.useEffect(() => {
        if (!restorePending) return;
        const context = Sidebar.context;
        const cancel = event => {
          if (!restorePending || event && !event.isTrusted) return;
          restorePending = false;
          restoreReference = null;
          try { window.localStorage.removeItem(selectedDeviceKey); } catch { /* optional persistence */ }
        };
        const attempt = () => {
          if (!restorePending || runtimeClosed || navigation !== 0 || !mirrorState.snapshot) return;
          if (context.layout.panelInfo.getSnapshot().activePanelId !== null) { cancel(); return; }
          if (context.sessions.list.getSnapshot().phase !== 'ready' || context.workspaces.list.getSnapshot().phase !== 'ready') return;
          const reference = restoreReference;
          restorePending = false;
          restoreReference = null;
          queueMicrotask(() => {
            if (runtimeClosed || navigation !== 0) return;
            if (reference.sessionId === null) chooseDeviceProject(reference.targetId);
            else void openDeviceSession(reference).catch(() => {});
          });
        };
        document.addEventListener('pointerdown', cancel, true);
        document.addEventListener('keydown', cancel, true);
        const unsubscribeSessions = context.sessions.list.subscribe(attempt);
        const unsubscribeWorkspaces = context.workspaces.list.subscribe(attempt);
        attempt();
        return () => {
          unsubscribeSessions();
          unsubscribeWorkspaces();
          document.removeEventListener('pointerdown', cancel, true);
          document.removeEventListener('keydown', cancel, true);
        };
      }, [remote.snapshot]);
      const knownConnections = React.useRef({});
      const warmedConnections = React.useRef(new Map());
      React.useEffect(() => {
        if (!remote.snapshot) return;
        const before = knownConnections.current;
        const warmed = warmedConnections.current;
        const connections = remote.snapshot.connections ?? {};
        knownConnections.current = connections;
        const selected = runtimeSnapshot.active;
        for (const [targetId, previousId] of Object.entries(before)) {
          if (connections[targetId] === previousId) continue;
          warmed.delete(targetId);
          void pool?.retire(targetId).catch(() => {});
          if (selected?.targetId === targetId) {
            navigation++;
            publishRuntime({ active: selected, phase: 'offline', error: null });
          }
        }
        if (selected && runtimeSnapshot.phase === 'offline' && canOpenDevice(selected.targetId)) {
          void openDeviceSession(selected, { reconnect: true }).catch(() => {});
        }
        for (const [targetId, connectionId] of Object.entries(connections)) {
          const previous = warmed.get(targetId);
          if (!canOpenDevice(targetId) || (previous?.connectionId === connectionId && previous.retryAt > Date.now())) continue;
          const attempt = { connectionId, retryAt: Infinity };
          warmed.set(targetId, attempt);
          // Keep a Client ready for this SSH connection without selecting or
          // creating a conversation. A click joins the same in-flight startup.
          void devicePool().then(next => {
            if (runtimeClosed || warmed.get(targetId) !== attempt) return;
            if (currentConnection(targetId) !== connectionId || !canOpenDevice(targetId)) {
              warmed.delete(targetId);
              return;
            }
            return next.ensure(targetId, { connectionId });
          }).catch(() => {
            // Let later mirror updates retry without starting on every update.
            attempt.retryAt = Date.now() + 15000;
          });
        }
      }, [remote.snapshot]);
      return null;
    }
    function sessionWriterConflict(session) {
      const openError = session.openError;
      if (openError?.code === 'session/writer-held') return openError;
      const promptError = session.promptError?.error;
      if (promptError?.code === 'session/writer-held') return promptError;
      // Background Agent activation reports only a message; history can already be open.
      const message = session.lastAgentError;
      return message === `session "${session.sessionId}" is already owned by an active write handle` ? message : null;
    }
    function SessionOpenNotice({ t, sessionId, useSession, retryOpen }) {
      const conflict = useSession(sessionWriterConflict);
      return conflict ? h(SessionInUseNotice, { key: sessionId, t, conflict, retryOpen }) : null;
    }
    function SessionInUseNotice({ t, conflict, retryOpen }) {
      const [result, setResult] = React.useState(null);
      const pending = React.useRef(null);
      React.useEffect(() => () => pending.current?.abort(), []);
      const retry = async () => {
        if (pending.current) return;
        const controller = new AbortController();
        pending.current = controller;
        setResult({ status: 'pending' });
        try {
          const outcome = await retryOpen(controller.signal);
          if (controller.signal.aborted) return;
          if (outcome.ok) setResult({ status: 'open', conflict });
          else setResult(outcome.error?.code === 'session/writer-held' ? null : { status: 'error' });
        } catch {
          if (!controller.signal.aborted) setResult({ status: 'error' });
        } finally {
          pending.current = null;
        }
      };
      if (result?.conflict === conflict) return null;
      return h('div', { className: 't3-session-open-notice', 'aria-busy': result?.status === 'pending' },
        h('style', null, `
          .t3-session-open-notice {
            box-sizing: border-box;
            width: calc(100% - 2 * var(--dsh-composer-side-clearance, 16px));
            max-width: var(--dsh-composer-card-max-width, 952px);
            margin-inline: auto;
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 4px 8px;
            border-radius: var(--dsw-radius-md);
            background: var(--dsw-alias-interactive-bg-hover);
            color: var(--dsw-alias-label-secondary);
            font-size: 12px;
            line-height: 18px;
          }
          .t3-session-open-notice > svg {
            flex: none;
            width: 14px;
            height: 14px;
            color: var(--dsw-alias-state-warn-label);
          }
          .t3-session-open-notice > p { flex: 1; min-width: 0; margin: 0; overflow-wrap: anywhere; }
          .t3-session-open-notice > button { flex: none; }
        `),
        h(IconWarningOutlineRegular, { 'aria-hidden': true }),
        h('p', { role: 'alert' }, result?.status === 'error' ? t('openFailed') + ' ' : null, t('sessionInUse')),
        h(Button, { type: 'button', size: 'sm', variant: 'ghost', disabled: result?.status === 'pending', onClick: retry }, t('retry')));
    }
    function installSessionOpenNotice(context) {
      const name = 'conversation.input.dock';
      const commands = context.get('remote.commands');
      return context.slots.inject(name, () => context.slots.register({
        name, id: 't3-session-open-notice', order: -100, locale: NS,
        inject: sessionId => ({
          async retryOpen(signal) {
            // Reading the command list uses DSH's normal Agent resolver without sending a prompt.
            const result = await commands.list(sessionId);
            signal.throwIfAborted();
            if (result.ok) context.uiWorkspace.openSession(sessionId);
            return result;
          },
        }),
      }, SessionOpenNotice));
    }
    function DeviceOpening({ t }) {
      const [visible, setVisible] = React.useState(false);
      React.useEffect(() => {
        const timer = setTimeout(() => setVisible(true), 120);
        return () => clearTimeout(timer);
      }, []);
      return visible ? h('div', { className: 't3-device-error', role: 'status' }, h('p', null, t('remoteOpening'))) : null;
    }
    function DeviceConversation({ t }) {
      const runtime = useDeviceRuntime();
      const reference = runtime.active;
      const connection = reference && runtime.pool?.connectionStatus?.(reference.targetId);
      const reconnecting = runtime.phase === 'ready' && (connection === 'connecting' || connection === 'disconnected');
      return h('section', { className: 't3-device-main' }, h('style', null, css),
        reconnecting && h('div', { className: 't3-device-reconnecting', role: 'status' }, t('remoteStreamReconnecting')),
        runtime.phase === 'ready' && reference &&
          h('div', { className: 't3-device-main-content' }, runtime.pool?.render(reference.targetId)),
        runtime.phase === 'loading' && h(DeviceOpening, { t, key: JSON.stringify(reference) }),
        (runtime.phase === 'error' || runtime.phase === 'offline') &&
          h('div', { className: 't3-device-error', role: runtime.phase === 'error' ? 'alert' : 'status' },
            h('p', null, t(runtime.phase === 'error' ? 'openFailed' : 'remoteDisconnected')),
            runtime.error && h('p', null, runtime.error),
            runtime.phase === 'error' && reference && h('button', {
              type: 'button', className: 't3-btn', onClick: () => { void openDeviceSession(reference, { refresh: true }).catch(() => {}); },
            }, t('retry'))));
    }
    function deviceLabel({ label, status }, t) {
      return status === 'ready' ? label : `${label} · ${t(remoteStatusKey(status))}`;
    }
    const LOCAL_DEVICE = '::local';
    const ADD_PROJECT = '::add-project';
    const deviceMenuId = targetId => targetId ?? LOCAL_DEVICE;
    const targetForMenuId = id => id === LOCAL_DEVICE ? null : id;
    function deviceMenuItems(machines, t) {
      return machines.map(machine => ({
        id: deviceMenuId(machine.targetId), label: deviceLabel(machine, t), icon: h(MachineIcon, { kind: machine.kind, size: 16 }),
      }));
    }
    function projectMenuItems(projects) {
      const entries = projects.map(project => ({ ...project, name: project.title || pathLabel(project.path) }));
      const nameCounts = new Map();
      for (const { name } of entries) nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
      return entries.map(({ workspaceId, path, name }) => ({
        id: workspaceId, label: nameCounts.get(name) > 1 ? name + ' · ' + path : name,
        icon: h(IconFolderCloseRegular, { size: 16 }),
      }));
    }
    function useDeviceProjects(targetId, workspaces, snapshot) {
      const [busy, setBusy] = React.useState(false);
      const [error, setError] = React.useState('');
      const [adding, setAdding] = React.useState(false);
      const request = React.useRef(null);
      React.useEffect(() => () => request.current?.abort(), []);
      const local = targetId === null;
      const machine = snapshot?.targets?.[targetId];
      const online = local || canManageDevice(targetId);
      const projects = (local ? (workspaces?.items ?? []).slice() : Object.values(snapshot?.workspaces ?? {}).filter(item => item.targetId === targetId))
        .sort((a, b) => (a.title || a.path).localeCompare(b.title || b.path));
      const start = async workspaceId => {
        if (request.current || !online) return;
        const controller = new AbortController();
        request.current = controller;
        setBusy(true);
        setError('');
        try {
          if (local) await Sidebar.context.uiWorkspace.openWorkspace(workspaceId);
          else await createAndOpenDeviceSession(targetId, workspaceId, controller.signal);
        } catch (error) {
          if (!controller.signal.aborted) setError(error?.message ?? String(error));
        } finally {
          request.current = null;
          if (!controller.signal.aborted) setBusy(false);
        }
      };
      return {
        busy, error, adding, local, machine, online, projects, start,
        clearError: () => setError(''),
        add() { setError(''); setAdding(true); },
        closeAdd() { setAdding(false); },
      };
    }
    function PickerMenu({ text, icon, label, items, footer, selectedId, onSelect, disabled, statusId, compact, beforeOpen }) {
      const [open, setOpen] = React.useState(false);
      const shown = open && !disabled;
      React.useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
      const anchor = h(Button, {
        variant: compact ? 'ghost' : 'outline', size: compact ? 'sm' : 'md',
        className: compact ? 't3-picker-trigger t3-picker-compact' : 't3-picker-trigger',
        icon, disabled, 'aria-label': label, 'aria-describedby': statusId,
        'aria-haspopup': 'menu', 'aria-expanded': shown,
        onClick: () => {
          if (!open) beforeOpen?.();
          setOpen(!open);
        },
      }, h('span', { className: 't3-picker-text' }, text), h(IconChevronDownOutlineRegular, { size: compact ? 12 : 14 }));
      return h(Menu, {
        anchor, open: shown, onClose: () => setOpen(false), items, footer, selectedId,
        onSelect: id => { setOpen(false); onSelect(id); }, portal: true, autoFocus: true,
        minWidthFromAnchor: !compact,
      });
    }
    function DeviceProjectPicker({ targetName, flow, statusId, t }) {
      const projects = projectMenuItems(flow.projects);
      const add = { id: ADD_PROJECT, label: t('addWorkspace'), icon: h(IconPlusOutlineRegular, { size: 16 }) };
      return h(PickerMenu, {
        text: t(flow.busy ? 'remoteDeviceStarting' : 'chooseProject'), icon: h(IconFolderCloseRegular, { size: 16 }),
        items: projects.length ? projects : [add], footer: projects.length ? [add] : undefined,
        onSelect: id => { if (id === ADD_PROJECT) flow.add(); else void flow.start(id); },
        label: t('chooseProject') + ' · ' + targetName, statusId, disabled: !flow.online || flow.adding || flow.busy, compact: true,
      });
    }
    function DeviceHeroWorkspace({ currentTargetId, open, anchorRef, selectedId, onPick, onClose, renderFactorySlot }) {
      const context = Sidebar.context;
      React.useSyncExternalStore(listener => context.locale.subscribe(listener), () => context.locale.getSnapshot());
      const t = context.locale.bind(NS);
      const workspaces = React.useSyncExternalStore(listener => context.workspaces.list.subscribe(listener), () => context.workspaces.list.getSnapshot());
      const { snapshot } = useRemoteMachines(context);
      const [selection, setSelection] = React.useState(null);
      const [seat, setSeat] = React.useState(null);
      const targetId = selection ? selection.targetId : currentTargetId;
      const staged = targetId !== currentTargetId;
      const flow = useDeviceProjects(targetId, workspaces, snapshot);
      const machines = remoteTargetsOf(snapshot).sort((a, b) => a.label.localeCompare(b.label));
      if (targetId && !flow.machine) machines.push({ targetId, label: selection?.label ?? targetId, status: 'down' });
      const t3StatusId = React.useId();
      React.useLayoutEffect(() => {
        const anchor = anchorRef?.current;
        if (!anchor?.parentElement) return;
        // The workspace slot sits after the trigger. Use its owner ref to mount
        // before the trigger in both tab order and layout.
        const node = anchor.ownerDocument.createElement('div');
        node.className = 't3-hero-seat';
        anchor.before(node);
        setSeat(node);
        return () => node.remove();
      }, [anchorRef]);
      React.useLayoutEffect(() => {
        if (!staged || !seat) return;
        const card = seat.closest('[data-composer-seat]')?.querySelector('[data-composer-card]');
        if (!card || card.inert) return;
        card.inert = true;
        card.setAttribute('data-t3-device-inert', '');
        return () => {
          card.inert = false;
          card.removeAttribute('data-t3-device-inert');
        };
      }, [staged, seat]);
      const targetName = flow.machine?.label ?? (targetId ? selection?.label ?? targetId : t('remoteDeviceThisMachine'));
      const deviceItems = deviceMenuItems([{ targetId: null, label: t('remoteDeviceThisMachine'), status: 'ready' }, ...machines], t);
      const selectDevice = id => {
        const targetId = targetForMenuId(id);
        const machine = machines.find(machine => machine.targetId === targetId);
        if (targetId !== null && !machine) return;
        setSelection({ targetId, label: machine?.label ?? t('remoteDeviceThisMachine') });
        flow.clearError();
      };
      let status = flow.error && errorWithDetail(t('remoteDeviceFailed'), flow.error);
      if (!status && !flow.online) status = t(flow.machine?.status === 'connecting' ? 'remoteConnecting' : 'remoteDeviceUnreachable');
      if (!status && !flow.projects.length) status = t(flow.local && workspaces?.phase !== 'ready'
        ? 'remoteLoading' : flow.local ? 'localNoProjects' : 'remoteDeviceNoProjects');
      return h(React.Fragment, null,
        !staged && renderFactorySlot('workspace.picker', { open, anchorRef, selectedId, onPick, onClose }),
        seat && machines.length > 0 && createPortal(h(React.Fragment, null, h('style', null, css),
          h('div', { className: 't3-hero-pickers', 'data-staged': staged },
            h(PickerMenu, {
              text: targetName, icon: h(MachineIcon, { kind: flow.machine?.kind, size: 16 }),
              label: `${t('remoteDeviceChip')} · ${targetName}`, items: deviceItems, disabled: flow.busy || flow.adding,
              selectedId: deviceMenuId(targetId), onSelect: selectDevice, compact: true,
              beforeOpen: open ? onClose : undefined,
            }),
            staged && h(DeviceProjectPicker, { key: targetId, targetName, flow, statusId: status ? t3StatusId : undefined, t }),
            staged && status && h('span', { className: 't3-hero-picker-status', id: t3StatusId, role: flow.error ? 'alert' : 'status' }, status))), seat),
        flow.adding && h(AddProjectDialog, { machines: [deviceForFolder(targetId, snapshot, t)], t, close: flow.closeAdd }));
    }
    function installDeviceWorkspacePicker(context, targetId = null) {
      const slots = ['conversation.hero.workspace.directoryFlow', 'workspace.picker.directoryFlow', 'sidebar.workspaces.directoryFlow'];
      const disposers = slots.map(name => context.slots.inject(name, () => context.slots.register({ name, priority: -1000 },
        props => h(DirectoryFlowDialog, { ...props, targetId }))));
      disposers.push(context.slots.inject('conversation.hero.workspace', () => context.slots.register({
        name: 'conversation.hero.workspace', priority: -1000,
      }, props => h(DeviceHeroWorkspace, { ...props, currentTargetId: targetId }))));
      return () => { for (const dispose of disposers) dispose(); };
    }
    function NewDeviceSession({ t, useWorkspaces }) {
      const choice = React.useSyncExternalStore(choiceSubscribe, () => deviceChoice, () => deviceChoice);
      const { snapshot } = useRemoteMachines(Sidebar.context);
      const workspaces = useWorkspaces(value => value);
      const flow = useDeviceProjects(choice.targetId, workspaces, snapshot);
      const machines = remoteTargetsOf(snapshot).sort((a, b) => a.label.localeCompare(b.label));
      const deviceName = flow.machine?.label ?? choice.targetId ?? t('remoteDeviceThisMachine');
      const devices = deviceMenuItems([deviceForFolder(null, snapshot, t), ...machines], t);
      return h('section', { className: 't3-new-session' }, h('style', null, css),
        h('div', { className: 't3-new-card' },
          h('h1', null, t('newSession')),
          h('p', { className: 't3-new-hint' }, t('deviceHint')),
          h('div', { className: 't3-new-fields' },
            h('div', { className: 't3-new-field' }, h('span', null, t('remoteDeviceChip')),
              h(PickerMenu, {
                text: deviceName, label: t('remoteDeviceChip'), items: devices, selectedId: deviceMenuId(choice.targetId),
                icon: h(MachineIcon, { kind: flow.machine?.kind, size: 16 }), disabled: flow.busy || flow.adding,
                onSelect: id => { pickDevice(targetForMenuId(id)); flow.clearError(); },
              })),
            h('div', { className: 't3-new-field' }, h('span', null, t('project')),
              h(PickerMenu, {
                text: t(flow.busy ? 'remoteDeviceStarting' : 'chooseProject'), label: t('project'),
                icon: h(IconFolderCloseRegular, { size: 16 }), items: projectMenuItems(flow.projects),
                disabled: flow.busy || flow.adding || !flow.online || !flow.projects.length, onSelect: id => { void flow.start(id); },
              }))),
          !flow.online && h('p', { className: 't3-new-hint', role: 'status' }, t('remoteDeviceUnreachable')),
          flow.online && !flow.projects.length && h('p', { className: 't3-new-hint' }, t(flow.local ? 'localNoProjects' : 'remoteDeviceNoProjects')),
          flow.error && h('p', { className: 't3-new-hint', role: 'alert' }, errorWithDetail(t('remoteDeviceFailed'), flow.error)),
          h('div', { className: 't3-new-actions' },
            h(Button, { variant: 'outline', icon: h(IconPlusOutlineRegular, { size: 16 }), disabled: flow.busy || !flow.online, onClick: flow.add }, t('addWorkspace')))),
        flow.adding && h(AddProjectDialog, { machines: [deviceForFolder(choice.targetId, snapshot, t)], t, close: flow.closeAdd }));
    }

    let renameTarget = null;
    const renameListeners = new Set();
    const renameSubscribe = listener => { renameListeners.add(listener); return () => renameListeners.delete(listener); };
    function setRenameTarget(target) {
      renameTarget = target;
      for (const listener of [...renameListeners]) listener();
    }
    function RemoteRenameOverlay({ t }) {
      const target = React.useSyncExternalStore(renameSubscribe, () => renameTarget, () => renameTarget);
      return target && h(RenameRemoteSession, { key: target.targetId + '/' + target.sessionId, target, t });
    }
    function RenameRemoteSession({ target, t }) {
      const [title, setTitle] = React.useState(target.displayTitle || '');
      const [busy, setBusy] = React.useState(false);
      const [error, setError] = React.useState('');
      const formId = React.useId();
      const close = () => { if (renameTarget === target) setRenameTarget(null); };
      const submit = async event => {
        event.preventDefault();
        if (busy || !title.trim()) return;
        setBusy(true);
        setError('');
        try { await remoteSessionCommand(target, 'rename', title.trim()); close(); }
        catch (reason) { setError(reason?.message ?? String(reason)); setBusy(false); }
      };
      return h(Modal, {
        open: true, title: t('rename'), closeLabel: t('close'), onClose: () => { if (!busy) close(); },
        footer: h(React.Fragment, null,
          h(Button, { variant: 'outline', onClick: close, disabled: busy }, t('remoteCancel')),
          h(Button, { variant: 'primary', type: 'submit', form: formId, disabled: busy || !title.trim() }, t(busy ? 'remoteWorking' : 'save'))),
      }, h('form', { id: formId, className: 't3-rename-form', onSubmit: submit },
        h('style', null, css),
        h(Input, { value: title, maxLength: 200, 'aria-label': t('renameTitle'), 'data-modal-autofocus': true,
          onFocus: event => event.target.select(), onChange: event => setTitle(event.target.value), disabled: busy }),
        error && h('p', { className: 't3-new-hint', role: 'alert' }, errorWithDetail(t('actionFailed'), error))));
    }


    function folderOperations(targetId) {
      if (targetId === null) return {
        list: (path, signal) => remoteCall('t3-project-directory/list', path === undefined ? {} : { path }, signal),
        mkdir: (path, name) => remoteCall('t3-project-directory/create', { path, name }),
        add: path => Sidebar.context.workspaces.create({ path }),
      };
      return {
        async list(path, signal, refresh) {
          const { listing } = await remoteCall('t3-remote/browse', { targetId, ...(path ? { path } : {}), ...(refresh ? { refresh } : {}) }, signal);
          return listing;
        },
        async mkdir(path, name) {
          const result = await remoteCall('t3-remote/create-directory', { targetId, path, name });
          return result.path;
        },
        async add(path) {
          await remoteCall('t3-remote/workspace-create', { targetId, path });
          refreshMirror();
        },
      };
    }
    function FolderButton({ primary, action, children, ...props }) {
      return h(Button, { variant: primary ? 'primary' : 'outline', ...props, className: action ? 't3-folder-action' : undefined }, children);
    }

    function pathEditorParts(draft, windows) {
      const end = windows ? Math.max(draft.lastIndexOf('/'), draft.lastIndexOf('\\')) : draft.lastIndexOf('/');
      const directory = draft.slice(0, end + 1);
      const absolute = windows ? /^(?:[A-Za-z]:[\\/]|[\\/]{2}[^\\/]+[\\/]+[^\\/]+)/.test(directory) : directory.startsWith('/');
      return absolute ? { directory, prefix: draft.slice(end + 1).toLowerCase() } : null;
    }
    function sameFolderPath(left, right, windows) {
      if (!right) return false;
      const normalize = path => (windows ? path.replaceAll('\\', '/').toLowerCase() : path).replace(/\/+$/, '');
      return normalize(left) === normalize(right);
    }
    function FolderColumn({ listing, selected, showHidden, prefix, editing, onPick, disabled, t }) {
      const matches = entry => (showHidden || !entry.hidden || prefix.startsWith('.')) && entry.name.toLowerCase().startsWith(prefix);
      const narrow = Boolean(prefix) && listing.entries.some(matches);
      const entries = listing.entries.filter(entry => entry.path === selected || (narrow ? matches(entry) : showHidden || !entry.hidden));
      return h('div', { className: 't3-folder-column', 'aria-label': listing.path },
        entries.length === 0 && h('div', { className: 't3-folder-status' }, t('remoteEmptyLevel')),
        entries.map(entry => {
          const active = entry.path === selected;
          return h('button', {
            key: entry.path, type: 'button', className: 't3-folder-row', disabled, title: entry.path,
            'aria-pressed': active,
            onMouseDown: editing ? event => { if (event.button === 0) event.preventDefault(); } : undefined,
            onClick: () => onPick(entry.path, listing),
          }, h(active ? IconFolderOpenRegular : IconFolderCloseRegular, { size: 16 }), h('span', null, entry.name), h(IconChevronRightOutlineRegular, { size: 12 }));
        }));
    }
    function NewFolderDialog({ path, create, close, t }) {
      const formId = React.useId();
      const [name, setName] = React.useState('');
      const [busy, setBusy] = React.useState(false);
      const [error, setError] = React.useState('');
      const request = React.useRef(false);
      const submit = async event => {
        event.preventDefault();
        if (request.current || !name.trim()) return;
        request.current = true;
        setBusy(true);
        setError('');
        try { await create(name.trim()); }
        catch (reason) { setError(reason?.message ?? String(reason)); }
        finally { request.current = false; setBusy(false); }
      };
       return h(Modal, {
        open: true, title: t('remoteNewFolder'), description: path, closeLabel: t('close'),
        onClose: () => { if (!request.current) close(); },
        footer: h(React.Fragment, null,
          h(FolderButton, { action: true, onClick: close, disabled: busy }, t('remoteCancel')),
          h(FolderButton, { action: true, primary: true, type: 'submit', form: formId, disabled: busy || !name.trim() }, t(busy ? 'remoteWorking' : 'remoteCreate'))),
      }, h('form', { id: formId, className: 't3-rename-form', onSubmit: submit },
        h(Input, { value: name, onChange: event => setName(event.target.value), 'data-modal-autofocus': true,
          'aria-label': t('folderName'), placeholder: t('folderName'), maxLength: 200, disabled: busy }),
        error && h('div', { className: 't3-new-hint', role: 'alert' }, errorWithDetail(t('actionFailed'), error))));
    }

    function ProjectDirectoryDialog({ target, machines, onTarget, close, onPicked, busy: adopting = false, t }) {
      const [view, setView] = React.useState({ parent: null, selected: null, child: null });
      const [draft, setDraft] = React.useState(null);
      const [showHidden, setShowHidden] = React.useState(false);
      const [newFolder, setNewFolder] = React.useState(false);
      const [loading, setLoading] = React.useState(true);
      const [saving, setSaving] = React.useState(false);
      const [error, setError] = React.useState('');
      const request = React.useRef(null);
      const previewTimer = React.useRef(null);
      const previewSuspended = React.useRef(false);
      const committing = React.useRef(false);
      const columns = React.useRef(null);
      const breadcrumbs = React.useRef(null);
      const editButton = React.useRef(null);
      const pathInput = React.useRef(null);
      const restoreEditFocus = React.useRef(false);
      const focusPicked = React.useRef(false);
      const { parent, selected, child, previewPath } = view;
      const activeListing = child ?? parent;
      const path = selected ?? parent?.path;
      const windows = target.kind === 'windows' || /^[a-z]:[\\/]|^\\\\/i.test(activeListing?.home ?? draft ?? '');
      const parts = draft === null ? null : pathEditorParts(draft, windows);
      const matchesLevel = parts !== null && (parts.directory === previewPath || sameFolderPath(parts.directory, activeListing?.path, windows));
      const prefix = matchesLevel ? parts.prefix : '';
      const previewDirectory = matchesLevel ? undefined : parts?.directory;
      const busy = saving || adopting;
      const ready = Boolean(path) && !busy && !loading && draft === null;
      const online = target.targetId === null || canManageDevice(target.targetId);
      const { list, mkdir, add } = React.useMemo(() => folderOperations(target.targetId), [target.targetId]);
      const failed = t('actionFailed');
      const load = React.useCallback(async (path, parent, { refresh = false, preview = false, pick = false } = {}) => {
        clearTimeout(previewTimer.current);
        request.current?.abort();
        const controller = new AbortController();
        request.current = controller;
        setLoading(true);
        setError('');
        if (pick) {
          setView({ parent, selected: path, child: null });
          setDraft(null);
        }
        try {
          const listing = await list(path, controller.signal, refresh);
          if (!listing || typeof listing.path !== 'string') throw new Error(failed);
          if (controller.signal.aborted) return;
          const crumbs = listing.crumbs ?? [];
          const windowsPath = /^[a-z]:[\\/]|^\\\\/i.test(listing.home ?? listing.path);
          const land = level => {
            if (controller.signal.aborted) return;
            const match = level?.entries.find(entry => sameFolderPath(entry.path, listing.path, windowsPath));
            setView({ parent: match ? level : listing, selected: match?.path ?? null, child: match ? listing : null,
              previewPath: preview ? path : undefined });
          };
          const ancestor = path && !sameFolderPath(listing.path, listing.home, windowsPath) ? crumbs.at(-2)?.path : undefined;
          if (!parent && ancestor) {
            const parentScan = list(ancestor, controller.signal).catch(() => null);
            if (preview) parent = await parentScan;
            else {
              let timer;
              const limit = new Promise(resolve => { timer = setTimeout(() => resolve(undefined), 200); });
              parent = await Promise.race([parentScan, limit]);
              clearTimeout(timer);
              if (parent === undefined) void parentScan.then(level => { if (level) land(level); });
            }
          }
          if (controller.signal.aborted) return;
          land(parent);
          if (!preview) {
            const focused = document.activeElement;
            restoreEditFocus.current = pathInput.current !== null && (focused === pathInput.current || columns.current?.contains(focused));
            setDraft(null);
          }
        } catch (reason) {
          if (!controller.signal.aborted && !preview) {
            if (pick) setView({ parent, selected: null, child: null });
            setError(reason?.message ?? String(reason));
          }
        } finally {
          if (!controller.signal.aborted) setLoading(false);
        }
      }, [list, failed]);
      React.useEffect(() => {
        void load();
        return () => { clearTimeout(previewTimer.current); request.current?.abort(); };
      }, [target.targetId]);
      React.useEffect(() => {
        if (!online || !previewDirectory || previewSuspended.current) return;
        // Only the directory part needs a scan. The final segment filters
        // the matching pane locally, including hidden names after a dot.
        const timer = setTimeout(() => { void load(previewDirectory, undefined, { preview: true }); }, 250);
        previewTimer.current = timer;
        return () => clearTimeout(timer);
      }, [draft, previewDirectory, online, load]);
      React.useLayoutEffect(() => {
        if (draft !== null) return;
        if (focusPicked.current) {
          focusPicked.current = false;
          columns.current?.querySelector('.t3-folder-row[aria-pressed="true"]')?.focus({ preventScroll: true });
        } else if (restoreEditFocus.current) {
          restoreEditFocus.current = false;
          editButton.current?.focus({ preventScroll: true });
        }
      }, [draft]);
      React.useLayoutEffect(() => {
        if (columns.current) columns.current.scrollLeft = child ? columns.current.scrollWidth : 0;
        if (breadcrumbs.current) breadcrumbs.current.scrollLeft = breadcrumbs.current.scrollWidth;
      }, [view]);
      const choose = async () => {
        if (!ready || committing.current || !online) return;
        committing.current = true;
        if (onPicked) { onPicked(path); return; }
        setSaving(true);
        setError('');
        try { await add(path); close(); }
        catch (reason) { setError(reason?.message ?? String(reason)); }
        finally { committing.current = false; setSaving(false); }
      };
      const create = async name => {
        request.current?.abort();
        const controller = new AbortController();
        request.current = controller;
        const { signal } = controller;
        const directory = await mkdir(path, name);
        if (signal.aborted) return;
        const updated = directory ? await list(path, signal, true).catch(() => null) : null;
        if (signal.aborted) return;
        await load(directory || path, updated, { refresh: true });
        setNewFolder(false);
      };
      const crumbs = activeListing?.crumbs ?? [];
      const homeIndex = crumbs.findIndex(crumb => crumb.path === activeListing.home);
      const cancelScan = () => { clearTimeout(previewTimer.current); request.current?.abort(); setLoading(false); };
      const pickFolder = (entry, listing) => {
        focusPicked.current = draft !== null;
        void load(entry, listing, { pick: true });
      };
      const editPath = () => {
        cancelScan();
        setError('');
        previewSuspended.current = false;
        if (selected && !child) setView({ parent, selected: null, child: null });
        const separator = windows ? '\\' : '/';
        const terminates = path?.endsWith(separator) || windows && path?.endsWith('/');
        setDraft(path && !terminates ? path + separator : path ?? '');
      };
      return h(Modal, {
        open: true, title: t('projectFolderTitle'), className: 't3-folder-dialog', headless: true,
        onClose: () => { if (!committing.current && !adopting && !newFolder) close(); },
      },
        h('style', null, css),
        h('div', {
          className: 't3-folder-scope',
          ref: node => { if (node) node.inert = newFolder; },
          onKeyDown: event => {
            if (event.key !== 'Escape' || event.defaultPrevented || event.nativeEvent.isComposing || draft === null) return;
            event.preventDefault();
            event.stopPropagation();
            cancelScan();
            restoreEditFocus.current = true;
            setError('');
            setDraft(null);
            if (!parent && online) void load();
          },
        },
        h('header', { className: 't3-folder-head' },
          h('div', { className: 't3-folder-heading' },
            h('h2', { className: 't3-folder-title' }, t('projectFolderTitle')),
            machines?.length > 1 ? h(PickerMenu, {
              text: target.label, label: t('remoteDeviceChip'), items: deviceMenuItems(machines, t), selectedId: deviceMenuId(target.targetId),
              icon: h(MachineIcon, { kind: target.kind, size: 16 }), disabled: busy || newFolder, compact: true,
              onSelect: id => onTarget(targetForMenuId(id)),
            }) : target.targetId !== null && h('span', { className: 't3-folder-machine' }, h(MachineIcon, { kind: target.kind }), target.label)),

          h('div', { className: 't3-folder-path' },
            draft !== null ? h(Input, {
              value: draft, ref: pathInput, spellCheck: false, autoComplete: 'off', autoFocus: true, 'aria-label': t('remotePath'), disabled: busy || !online,
              onChange: event => {
                cancelScan();
                previewSuspended.current = false;
                setError('');
                setDraft(event.target.value);
              },
              onKeyDown: event => {
                if (event.key !== 'Enter' || event.nativeEvent.isComposing || !draft.trim()) return;
                event.preventDefault();
                previewSuspended.current = true;
                void load(draft);
              },
            }) : h(React.Fragment, null,
              h('nav', { className: 't3-folder-crumbs', ref: breadcrumbs, 'aria-label': t('remotePath') },
                (homeIndex >= 0 || crumbs.length === 0) && h('button', { type: 'button', disabled: busy || !online,
                  'aria-current': activeListing?.home === path || undefined, onClick: () => void load() }, t('remoteHome')),
                crumbs.slice(homeIndex + 1).map((crumb, index) => h(React.Fragment, { key: crumb.path },
                  (homeIndex >= 0 || index > 0) && h(IconChevronRightOutlineRegular, { size: 12 }),
                  h('button', { type: 'button', disabled: busy || !online, title: crumb.path, 'aria-current': crumb.path === path || undefined,
                    onClick: () => void load(crumb.path) }, crumb.name)))),
              h(Button, { ref: editButton, className: 't3-folder-edit', variant: 'ghost', size: 'sm', disabled: busy || !online,
                'aria-label': t('remotePath'), title: t('remotePath'), onClick: editPath }, h(IconEditOutlineRegular, { size: 14 }))))),
        h('div', { className: 't3-folder-columns', ref: columns, 'aria-busy': loading },
          parent && h(FolderColumn, { listing: parent, selected, showHidden, prefix: child ? '' : prefix, editing: draft !== null, onPick: pickFolder, disabled: busy || !online, t }),
          child && h(FolderColumn, { listing: child, showHidden, prefix, editing: draft !== null, onPick: pickFolder, disabled: busy || !online, t })),
        (error || !online) && h('div', { className: 't3-folder-status', role: 'alert' },
          !online ? t('remoteDeviceUnreachable') : errorWithDetail(t('actionFailed'), error)),
        loading && h('div', { className: 't3-folder-status', role: 'status' }, t('remoteLoading')),
        !loading && (parent?.truncated || child?.truncated) && h('div', { className: 't3-folder-status', role: 'status' }, t('remoteTruncated')),
        h('footer', { className: 't3-folder-footer' },
          h(FolderButton, { disabled: !ready || !online, onClick: () => setNewFolder(true), icon: h(IconPlusOutlineRegular, { size: 14 }) }, t('remoteNewFolder')),
          h(Button, { variant: 'ghost', size: 'sm', 'aria-pressed': showHidden, disabled: busy,
            onMouseDown: event => { if (draft !== null && event.button === 0) event.preventDefault(); },
            onClick: () => setShowHidden(value => !value),
          }, t('remoteShowHidden'), showHidden && h(IconCheckOutlineRegular, { size: 14 })),
          h('span', { className: 't3-folder-gap' }),
          h(FolderButton, { action: true, onClick: close, disabled: busy }, t('remoteCancel')),
          h(FolderButton, { action: true, primary: true, disabled: !ready || !online, onClick: () => void choose() }, t(busy ? 'remoteWorking' : 'remoteChoose')))),
        newFolder && h(NewFolderDialog, { path, create, close: () => setNewFolder(false), t }));
    }
    function AddProjectDialog({ machines, close, t, onPicked, busy }) {
      const [targetId, setTargetId] = React.useState(() =>
        (machines.find(machine => machine.status === 'ready') ?? machines[0])?.targetId);
      // Keep the selected device when it disconnects. An existing selection
      // must never start browsing or writing on another machine implicitly.
      const target = machines.find(machine => machine.targetId === targetId);
      const lastTarget = React.useRef(target);
      if (target) lastTarget.current = target;
      if (!lastTarget.current) return null;
      const device = target ?? { ...lastTarget.current, status: 'down' };
      return h(ProjectDirectoryDialog, { key: targetId ?? 'local', target: device,
        machines: target ? machines : [device, ...machines], onTarget: setTargetId, close, onPicked, busy, t });
    }
    function DirectoryFlowDialog({ open, busy, onPicked, onCancel, targetId }) {
      const context = Sidebar.context;
      React.useSyncExternalStore(listener => context.locale.subscribe(listener), () => context.locale.getSnapshot());
      const { snapshot } = useRemoteMachines(context);
      const t = context.locale.bind(NS);
      if (!open) return null;
      return h(AddProjectDialog, { machines: [deviceForFolder(targetId, snapshot, t)], close: onCancel, onPicked, busy, t });
    }
    function deviceForFolder(targetId, snapshot, t) {
      if (targetId === null) return { targetId, label: t('remoteDeviceThisMachine'), status: 'ready' };
      return snapshot?.targets?.[targetId] ?? { targetId, label: targetId, status: 'down' };
    }

    function Sidebar({
      wide, expandSidebar, useSessions, useSessionStatus, useWorkspaces, usePanelInfo, useContextMenu,
      renderFactorySlot, t,
    }) {
      const { getTriggerProps } = useContextMenu();
      const activePanelId = usePanelInfo(info => info.activePanelId);
      const panelActive = activePanelId !== null;
      const sessions = useSessions(s => s);
      const statuses = useSessionStatus(s => s);
      const workspaces = useWorkspaces(s => s);
      const remote = useRemoteMachines(Sidebar.context);
      const deviceRuntime = useDeviceRuntime();
      const nowMinute = useNowMinute();
      const [snapshot, setSnapshot] = React.useState(null);
      const [syncError, setSyncError] = React.useState(false);
      const [actionError, setActionError] = React.useState(false);
      const [uiError, setUiError] = React.useState('');
      const [collapsed, setCollapsed] = React.useState(() => ({ ...DEFAULT_COLLAPSED }));
      const [pending, setPending] = React.useState({});
      const [workingIds, setWorkingIds] = React.useState(() => new Set());
      const workingRef = React.useRef(new Map());
      React.useEffect(() => {
        const now = Date.now();
        const pinnedIds = new Set(workspaces?.pinnedSessionIds || []);
        const observations = (sessions?.ids || []).map(id => ({
          id, running: statuses?.get(id)?.running ?? sessions.byId?.[id]?.running,
          pendingInteraction: statuses?.get(id)?.pendingInteraction,
          settled: !!snapshot?.placements?.[id]?.settled, pinned: pinnedIds.has(id), updatedAt: sessions.byId?.[id]?.updatedAt,
        }));
        for (const row of Object.values(remote.snapshot?.sessions ?? {})) {
          const status = deviceRuntime.pool?.status(row.targetId, row.sessionId);
          observations.push({ id: row.targetId + '/' + row.sessionId, running: status?.running ?? row.running,
            pendingInteraction: status?.pendingInteraction, pinned: row.pinned, settled: row.settled, updatedAt: row.updatedAt });
        }
        const present = new Set(observations.map(row => row.id));
        const next = new Set();
        let nextDeadline = Infinity;
        for (const { id, running, pendingInteraction, pinned, settled, updatedAt } of observations) {
          const placement = `${pinned}:${settled}`;
          const previous = workingRef.current.get(id);
          const actual = !!running && !pendingInteraction;
          const canWait = !actual && previous?.working && !pendingInteraction && !pinned && !settled && previous.placement === placement;
          const deadline = canWait ? (previous.deadline ?? now + 2000) : null;
          const working = actual || (deadline !== null && deadline > now);
          const anchor = Number.isFinite(updatedAt) ? Math.min(updatedAt, now) : now;
          const since = working ? (previous?.working ? previous.since ?? anchor : anchor) : null;
          workingRef.current.set(id, { working, deadline: working ? deadline : null, placement, since });
          if (working) next.add(id);
          if (working && deadline !== null) nextDeadline = Math.min(nextDeadline, deadline);
        }
        for (const id of workingRef.current.keys()) if (!present.has(id)) workingRef.current.delete(id);
        setWorkingIds(next);
        if (nextDeadline === Infinity) return;
        let timer;
        const schedule = (deadline) => {
          timer = setTimeout(() => {
            const at = Date.now();
            let following = Infinity;
            for (const state of workingRef.current.values()) {
              if (state.deadline !== null && state.deadline <= at) {
                state.working = false;
                state.deadline = null;
                state.since = null;
              }
              if (state.deadline !== null) following = Math.min(following, state.deadline);
            }
            setWorkingIds(new Set([...workingRef.current].filter(([, state]) => state.working).map(([id]) => id)));
            if (following !== Infinity) schedule(following);
          }, Math.max(0, deadline - Date.now()));
        };
        schedule(nextDeadline);
        return () => clearTimeout(timer);
      }, [sessions, statuses, workspaces, snapshot, remote.snapshot, deviceRuntime]);
      const rootRef = React.useRef(null);
      const loading = !snapshot && !remote.snapshot && !sessions?.ids?.length;
      // Fit below the host navigation so the bottom groups are visible as
      // soon as the sidebar opens. The short layout has one native scroller.
      React.useLayoutEffect(() => {
        const node = rootRef.current;
        if (!wide || !node) return undefined;
        let section = node;
        let viewport = section.parentElement;
        while (viewport && !/(auto|scroll)/.test(window.getComputedStyle(viewport).overflowY)) {
          section = viewport;
          viewport = section.parentElement;
        }
        if (!viewport) return undefined;
        const fit = () => {
          const offset = node.getBoundingClientRect().top - viewport.getBoundingClientRect().top + viewport.scrollTop;
          const height = `${Math.max(0, Math.floor(viewport.clientHeight - offset))}px`;
          if (node.style.getPropertyValue('--t3-fill') !== height) node.style.setProperty('--t3-fill', height);
        };
        fit();
        if (typeof ResizeObserver === 'undefined') return undefined;
        const observer = new ResizeObserver(fit);
        observer.observe(viewport);
        for (let sibling = section.previousElementSibling; sibling; sibling = sibling.previousElementSibling) {
          observer.observe(sibling);
        }
        return () => observer.disconnect();
      }, [wide]);
      const pollRef = React.useRef(null);
      const operations = React.useRef(new Set());
      const alive = React.useRef(false);
      const context = Sidebar.context;
      React.useEffect(() => {
        alive.current = true;
        let cursor = null;
        let stopped = false;
        let timer;
        let active;
        const run = async () => {
          active = new AbortController();
          pollRef.current = active;
          try {
            const value = unwrap(await context.connection.rpc.call('/api', 't3-session-sidebar/snapshot', cursor || {}, active.signal));
            if (!validSnapshot(value)) throw new Error('Invalid snapshot');
            if (stopped) return;
            cursor = { epoch: value.epoch, revision: value.revision };
            setSnapshot(value);
            setSyncError(false);
            timer = setTimeout(run, 250);
          } catch (error) {
            if (stopped) return;
            if (!active.signal.aborted) setSyncError(true);
            cursor = null;
            timer = setTimeout(run, active.signal.aborted ? 0 : 2000);
          }
        };
        run();
        return () => {
          stopped = true;
          alive.current = false;
          clearTimeout(timer);
          active?.abort();
          pollRef.current = null;
          for (const operation of operations.current) operation.abort();
          operations.current.clear();
        };
      }, [context]);
      const act = async (id, action) => {
        if (pending[id] || syncError || !snapshot) return;
        setActionError(false);
        const controller = new AbortController();
        operations.current.add(controller);
        setPending(value => ({ ...value, [id]: true }));
        try {
          unwrap(await context.connection.rpc.call('/api', 't3-session-sidebar/action', { action, sessionId: id }, controller.signal));
        } catch (error) {
          if (alive.current && !controller.signal.aborted) setActionError(true);
        } finally {
          operations.current.delete(controller);
          if (alive.current) {
            setPending(value => { const next = { ...value }; delete next[id]; return next; });
            // Both success and failure can have changed durable state.
            pollRef.current?.abort();
          }
        }
      };
      // The same verb on a session that lives on another machine: hand it to that
      // machine's own plugin. It bumps its revision, and the mirror's long poll brings
      // the new placement back — so nothing here writes the mirror.
      const actRemote = async (targetId, sessionId, action) => {
        const key = targetId + '/' + sessionId;
        if (pending[key]) return;
        setActionError(false);
        const controller = new AbortController();
        operations.current.add(controller);
        setPending(value => ({ ...value, [key]: true }));
        try {
          requireRemoteReady(targetId);
          unwrap(await context.connection.rpc.call('/api', 't3-remote/action', { targetId, sessionId, action }, controller.signal));
          refreshMirror();
        } catch {
          if (alive.current && !controller.signal.aborted) setActionError(true);
        } finally {
          operations.current.delete(controller);
          if (alive.current) {
            setPending(value => { const next = { ...value }; delete next[key]; return next; });
            // The machine made a session, so the mirror has a row to bring back.
            pollRef.current?.abort();
          }
        }
      };
      const runUi = (fn, errorKey) => {
        setUiError('');
        try { Promise.resolve(fn()).catch(() => { if (alive.current) setUiError(errorKey); }); }
        catch { setUiError(errorKey); }
      };
      // T3's row header names the project; DSH's equivalent is the Workspace
      // the session is accounted to, falling back to its directory name.
      const workspaceLabel = new Map();
      for (const workspace of workspaces?.items || []) {
        const label = workspace.title || pathLabel(workspace.path);
        if (!label) continue;
        for (const id of workspace.sessionIds || []) workspaceLabel.set(id, label);
      }
      const archived = new Set(workspaces?.archivedSessionIds || []);
      const pinned = new Set(workspaces?.pinnedSessionIds || []);
      const groups = Object.fromEntries(GROUPS.map(group => [group, []]));
      let hasWorking = false;
      const addRow = (row, status, { pinned, settled, running }) => {
        const state = status?.pendingInteraction ? 'warning'
          : (status?.running ?? running) || workingIds.has(row.id) ? 'ongoing'
          : status?.completionUnread ? 'done' : null;
        // A pin from the native sidebar can coexist with our settled flag.
        const group = pinned ? 'pinned' : settled ? 'settled' : state === 'ongoing' ? 'working' : 'active';
        if (group === 'working') hasWorking = true;
        groups[group].push({ ...row, state });
      };
      // The main view can keep a new draft open until its first turn.
      for (const id of sessions?.ids || []) {
        const session = sessions.byId?.[id];
        if (!session || session.blank || archived.has(id) || session.origin === 'subagent') continue;
        const title = session.displayTitle || t('untitled');
        const placement = snapshot?.placements?.[id];
        addRow({ id, title, session, placement }, statuses?.get(id), {
          pinned: pinned.has(id), settled: placement?.settled, running: session.running,
        });
      }
      // Mirrored sessions use the same groups with the placement flags
      // reported by their own machine.
      const machines = remoteTargetsOf(remote.snapshot).slice().sort((a, b) => String(a.label).localeCompare(String(b.label)));
      const remoteWorkspaces = new Map(Object.values(remote.snapshot?.workspaces ?? {}).map(row => [row.targetId + '/' + row.workspaceId, row]));
      // A machine can only take the row verbs its own plugin understands, so compare
      // its reported contract with the one this mirror speaks.
      const mirrorContract = remote.snapshot?.contract ?? null;
      const offline = machines.filter(machine => machine.status === 'down');
      for (const row of Object.values(remote.snapshot?.sessions ?? {})) {
        if (row.blank || row.archived || row.origin === 'subagent') continue;
        const remoteTitle = row.displayTitle || t('untitled');
        const machine = machines.find(known => known.targetId === row.targetId);
        if (!machine) continue;
        const id = row.targetId + '/' + row.sessionId;
        const status = deviceRuntime.pool?.status(row.targetId, row.sessionId);
        addRow({ id, title: remoteTitle, session: { updatedAt: row.updatedAt, cwd: row.cwd }, placement: null, remote: row, machine }, status, row);
      }
      const pins = workspaces?.pinnedSessionIds || [];
      const activity = row => Math.max(row.session.updatedAt || 0, row.placement?.unsettledAt || 0);
      React.useEffect(() => {
        // Reopen when work starts, while honouring a manual toggle until
        // the group next goes from empty to populated.
        const working = !hasWorking;
        setCollapsed(value => value.working === working ? value : { ...value, working });
      }, [hasWorking]);
      const pinOrder = row => {
        const order = row.remote
          ? remoteWorkspaces.get(row.remote.targetId + '/' + row.remote.workspaceId)?.pinnedSessionIds?.indexOf(row.remote.sessionId)
          : pins.indexOf(row.id);
        return order >= 0 ? order : Number.MAX_SAFE_INTEGER;
      };
      groups.pinned.sort((a, b) => pinOrder(a) - pinOrder(b) || activity(b) - activity(a) || a.id.localeCompare(b.id));
      const isWaiting = row => row.state === 'warning';
      const activeWaiting = groups.active.filter(isWaiting).length;
      groups.active.sort((a, b) => Number(isWaiting(b)) - Number(isWaiting(a)) || activity(b) - activity(a));
      groups.working.sort((a, b) => activity(b) - activity(a));
      // A mirrored settled row carries no local settledAt, so it falls back to the
      // machine's own last activity rather than dropping to the bottom of the shelf.
      groups.settled.sort((a, b) => (b.placement?.settledAt || activity(b)) - (a.placement?.settledAt || activity(a)));
      const visibleGroups = GROUPS.filter(group => group !== 'pinned' || groups.pinned.length > 0);
      const sectionId = React.useId();
      if (!wide) return h('div', { className: 't3-sidebar' }, h('style', null, css), h('button', { className: 't3-btn', type: 'button', title: t('expand'), 'aria-label': t('expand'), onClick: expandSidebar }, '☰'));
      return h('div', { className: 't3-sidebar', ref: rootRef, 'data-expanded': true }, h('style', null, css),
        h('div', { className: 't3-header' }, t('sessions')),
        (syncError || actionError) && h('div', { className: 't3-message', role: 'status' }, t(actionError ? 'actionFailed' : 'syncing')),
        uiError && h('div', { className: 't3-message', role: 'alert' }, t(uiError)),
        !!offline.length && h('div', { className: 't3-message', role: 'status' },
          t('remoteOfflineNote').replace('{name}', offline.map(machine => machine.label).join(', '))),
        remote.error && h('div', { className: 't3-message', role: 'status' }, t('remoteError')),
        loading ? h('div', { className: 't3-message', role: 'status' }, t(syncError ? 'syncing' : 'loading')) :
        h('div', { className: 't3-list-frame' }, h('div', { className: 't3-list' }, visibleGroups.map(group => h('section', {
          className: 't3-group', key: group, 'data-group': group, 'data-has-rows': !collapsed[group] && groups[group].length > 0,
        },
          h('button', { className: 't3-btn t3-heading', type: 'button', 'aria-expanded': !collapsed[group], 'aria-controls': `${sectionId}-${group}`, onClick: () => setCollapsed(value => ({ ...value, [group]: !value[group] })) },
            h('span', { 'aria-hidden': true }, collapsed[group] ? '▸' : '▾'), t(group),
            group === 'active' && activeWaiting > 0 && h('span', { className: 't3-waiting' }, t('waitingCount').replace('{n}', activeWaiting)),
            h('span', { className: 't3-count' }, String(groups[group].length))),
          h('div', { id: `${sectionId}-${group}`, className: 't3-rows', hidden: !!collapsed[group] },
          !collapsed[group] && groups[group].map(({ id, title, session, placement, remote, machine, state }) => {
            const live = state === 'ongoing';
            const stateLabel = state && t('status' + state[0].toUpperCase() + state.slice(1));
            const duration = live ? workingDuration(t, workingRef.current.get(id)?.since, nowMinute) : null;
            const time = live
              ? h('span', { className: 't3-time t3-live' },
                h(StatusGlyph, { state: 'ongoing' }), h('span', null, stateLabel), duration)
              : h('span', { className: 't3-time', 'aria-hidden': true }, timeLabel(t, session.updatedAt, nowMinute));
            const titleLine = (disabled = false) => h('div', { className: 't3-line' },
              h('button', { className: 't3-open', type: 'button', title, disabled }, title),
              state && !live && h('span', { className: 't3-status', role: 'img', 'aria-label': stateLabel, title: stateLabel }, h(StatusGlyph, { state })),
              time);
            if (remote) {
              const workspace = remoteWorkspaces.get(remote.targetId + '/' + (remote.workspaceId ?? ''));
              const online = canManageDevice(remote.targetId);
              const canOpen = canOpenDevice(remote.targetId);
              const canVerb = online && Number.isInteger(mirrorContract) && machine.pluginContract === mirrorContract;
              const busy = !!pending[id];
              const pinAction = remote.pinned ? 'unpin' : 'pin';
              const settleAction = remote.settled ? 'unsettle' : 'settle';
              const target = { kind: 't3-device-session', value: { targetId: remote.targetId, sessionId: remote.sessionId, displayTitle: title } };
              const open = () => { if (canOpen) runUi(() => openDeviceSession({ targetId: remote.targetId, sessionId: remote.sessionId }), 'openFailed'); };
              const trigger = getTriggerProps(target, {
                tabIndex: -1,
                onKeyDown: event => {
                  if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); open(); }
                },
              });
              return h('div', {
                className: 't3-row', key: id, ...trigger, 'data-remote': true, 'data-working': live,
                'data-current': activePanelId === DEVICE_PANEL && deviceRuntime.active?.targetId === remote.targetId && deviceRuntime.active?.sessionId === remote.sessionId,
                'data-target': machine.targetId, 'data-open-disabled': !canOpen,
                title: canOpen ? workspace?.path ?? remote.cwd ?? '' : t('remoteDeviceUnreachable'), onClick: open,
              },
                h('div', { className: 't3-top' },
                  remote.pinned && h('span', { className: 't3-pin', 'aria-hidden': true }, h(PinIcon, { filled: true, size: 12 })),
                  h('span', { className: 't3-proj' }, workspace?.title || pathLabel(workspace?.path ?? remote.cwd ?? '')),
                  h('span', { className: 't3-slot', 'data-host': true },
                    h(MachineName, { machine, t }),
                    h('span', { className: 't3-actions', onClick: event => event.stopPropagation() },
                      h('button', { className: 't3-icon-button', 'data-pinned': remote.pinned, type: 'button', disabled: !canVerb || busy, title: t(pinAction), 'aria-label': `${t(pinAction)}: ${title}`, onClick: () => { void actRemote(machine.targetId, remote.sessionId, pinAction); } }, h(PinIcon, { filled: remote.pinned, size: 14 })),
                      h('button', { className: 't3-icon-button', type: 'button', disabled: !canVerb || busy, title: t(settleAction), 'aria-label': `${t(settleAction)}: ${title}`, onClick: () => { void actRemote(machine.targetId, remote.sessionId, settleAction); } }, h(SettledIcon, { restored: remote.settled })),
                      renderFactorySlot('contextMenu.button', { target, label: `${t('more')}: ${title}`, className: 't3-icon-button' })))),
                titleLine(!canOpen));
            }

            const isPinned = pinned.has(id);
            const isSettled = !!placement?.settled;
            const pinAction = isPinned ? 'unpin' : 'pin';
            const settleAction = isSettled ? 'unsettle' : 'settle';
            const target = { kind: 'session', value: { sessionId: id, displayTitle: session.displayTitle || '' } };
            const trigger = getTriggerProps(target, {
              tabIndex: -1,
              onKeyDown: event => {
                if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ') || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
                event.preventDefault();
                runUi(() => { context.uiWorkspace.openSession(id); deactivateDevice(); }, 'openFailed');
              },
            });
            const busy = !!pending[id] || syncError || !snapshot;
            const slot = h('span', { className: 't3-slot' },
              h('span', { className: 't3-actions', onClick: event => event.stopPropagation() },
                h('button', { className: 't3-icon-button', 'data-pinned': isPinned, type: 'button', disabled: busy, title: t(pinAction), 'aria-label': `${t(pinAction)}: ${title}`, onClick: () => act(id, pinAction) }, h(PinIcon, { filled: isPinned, size: 14 })),
                h('button', { className: 't3-icon-button', type: 'button', disabled: busy, title: t(settleAction), 'aria-label': `${t(settleAction)}: ${title}`, onClick: () => act(id, settleAction) }, h(SettledIcon, { restored: isSettled })),
                renderFactorySlot('contextMenu.button', { target, label: `${t('more')}: ${title}`, className: 't3-icon-button' })));
            const topLine = h('div', { className: 't3-top' },
              isPinned && h('span', { className: 't3-pin', 'aria-hidden': true }, h(PinIcon, { filled: true, size: 12 })),
              h('span', { className: 't3-proj' }, workspaceLabel.get(id) || pathLabel(session.cwd)),
              slot);
            // The whole surface opens the session, as in T3; the title button only
            // carries the accessible name and keyboard focus.
            return h('div', {
              className: 't3-row', key: id, ...trigger,
              'data-working': live,
              'data-current': !panelActive && (session.retainedBy?.mainView || 0) > 0,
              onClick: () => runUi(() => { context.uiWorkspace.openSession(id); deactivateDevice(); }, 'openFailed'),
            }, topLine, titleLine());
          })))))));
    }
    const SSH_SETTINGS_ID = 't3-ssh';
    const sshCopy = {
      en: {
        title: 'Session Harbor SSH', addHost: 'Add host', addConnect: 'Add and connect', adding: 'Adding…',
        config: 'SSH config hosts', chooseHost: 'Choose a host', noConfigHosts: 'No named hosts found in SSH config.',
        address: 'SSH address', advanced: 'Advanced options', label: 'Name', directory: 'Remote directory',
        executable: 'DSH executable', profile: 'Profile', remoteHome: 'Remote home directory',
        connected: 'Connected', connecting: 'Connecting…', disconnected: 'Disconnected', error: 'Connection failed',
        checkingPlugin: 'Checking Session Harbor…',
        pluginSyncNote: 'Connecting installs Session Harbor on the remote device if missing and upgrades older versions to the local version.',
        pluginSyncFailed: 'Could not install Session Harbor {version} on this host. Remote pinning and settling may be limited. Check pnpm and registry access, then reconnect.',
        connect: 'Connect', disconnect: 'Disconnect', cancelConnection: 'Cancel connection', cancel: 'Cancel',
        remove: 'Delete', close: 'Close', removeQuestion: 'Delete {host}?', removeActiveQuestion: 'Disconnect and delete {host}?',
        hostAction: '{action} ({host})', loading: 'Loading SSH connections…', empty: 'No saved SSH hosts.',
        refresh: 'Refresh', refreshing: 'Refreshing…', retry: 'Retry', requiredHost: 'Enter an SSH address or choose a host.',
        duplicate: 'This SSH host is already saved with these options.',
        requestFailed: 'Could not reach the SSH service.', requestTimedOut: 'The SSH request timed out.',
        httpError: 'The SSH service returned HTTP {status}.', invalidResponse: 'The SSH service returned an invalid response.',
      },
      ja: {
        title: 'Session Harbor SSH',
        addHost: 'ホストを追加',
        addConnect: '追加して接続',
        adding: '追加中…',
        config: 'SSH設定のホスト',
        chooseHost: 'ホストを選択',
        noConfigHosts: 'SSH設定に名前付きホストが見つかりませんでした。',
        address: 'SSHアドレス',
        advanced: '詳細オプション',
        label: '名前',
        directory: 'リモートディレクトリ',
        executable: 'DSH実行ファイル',
        profile: 'プロファイル',
        remoteHome: 'リモートのホームディレクトリ',
        connected: '接続済み',
        connecting: '接続中…',
        disconnected: '未接続',
        error: '接続に失敗しました',
        checkingPlugin: 'Session Harbor を確認中…',
        pluginSyncNote: '接続時にリモートの Session Harbor を確認し、未インストールまたは旧バージョンの場合はローカルと同じバージョンをインストールします。',
        pluginSyncFailed: 'このホストに Session Harbor {version} をインストールできませんでした。リモートセッションのピン留めや完了操作が制限される場合があります。pnpm とレジストリへの接続を確認してから再接続してください。',
        connect: '接続',
        disconnect: '切断',
        cancelConnection: '接続をキャンセル',
        cancel: 'キャンセル',
        remove: '削除',
        close: '閉じる',
        removeQuestion: '「{host}」を削除しますか？',
        removeActiveQuestion: '「{host}」との接続を切断して削除しますか？',
        hostAction: '{action}（{host}）',
        loading: 'SSH接続を読み込み中…',
        empty: '保存済みのSSHホストはありません。',
        refresh: '更新',
        refreshing: '更新中…',
        retry: '再試行',
        requiredHost: 'SSHアドレスを入力するか、ホストを選択してください。',
        duplicate: 'このSSHホストは同じ設定で保存済みです。',
        requestFailed: 'SSHサービスに接続できませんでした。',
        requestTimedOut: 'SSHリクエストがタイムアウトしました。',
        httpError: 'SSHサービスからHTTP {status}が返されました。',
        invalidResponse: 'SSHサービスから無効な応答が返されました。',
      },
      es: {
        title: 'Session Harbor SSH',
        addHost: 'Agregar host',
        addConnect: 'Agregar y conectar',
        adding: 'Agregando…',
        config: 'Hosts de la configuración SSH',
        chooseHost: 'Elegir un host',
        noConfigHosts: 'No se encontraron hosts con nombre en la configuración SSH.',
        address: 'Dirección SSH',
        advanced: 'Opciones avanzadas',
        label: 'Nombre',
        directory: 'Directorio remoto',
        executable: 'Ejecutable de DSH',
        profile: 'Perfil',
        remoteHome: 'Directorio personal remoto',
        connected: 'Conectado',
        connecting: 'Conectando…',
        disconnected: 'Desconectado',
        error: 'Error de conexión',
        checkingPlugin: 'Comprobando Session Harbor…',
        pluginSyncNote: 'Al conectar, Session Harbor se instala en el dispositivo remoto si falta y las versiones anteriores se actualizan a la versión local.',
        pluginSyncFailed: 'No se pudo instalar Session Harbor {version} en este host. Puede que las opciones para fijar o dar por finalizadas sesiones remotas estén limitadas. Comprueba pnpm y el acceso al registro y vuelve a conectar.',
        connect: 'Conectar',
        disconnect: 'Desconectar',
        cancelConnection: 'Cancelar conexión',
        cancel: 'Cancelar',
        remove: 'Eliminar',
        close: 'Cerrar',
        removeQuestion: '¿Eliminar {host}?',
        removeActiveQuestion: '¿Desconectar y eliminar {host}?',
        hostAction: '{action} ({host})',
        loading: 'Cargando conexiones SSH…',
        empty: 'No hay hosts SSH guardados.',
        refresh: 'Actualizar',
        refreshing: 'Actualizando…',
        retry: 'Reintentar',
        requiredHost: 'Escribe una dirección SSH o elige un host.',
        duplicate: 'Este host SSH ya está guardado con estas opciones.',
        requestFailed: 'No se pudo contactar con el servicio SSH.',
        requestTimedOut: 'Se agotó el tiempo de espera de la solicitud SSH.',
        httpError: 'El servicio SSH devolvió el código HTTP {status}.',
        invalidResponse: 'El servicio SSH devolvió una respuesta no válida.',
      },
      fr: {
        title: 'Session Harbor SSH',
        addHost: 'Ajouter un hôte',
        addConnect: 'Ajouter et connecter',
        adding: 'Ajout…',
        config: 'Hôtes de la configuration SSH',
        chooseHost: 'Choisir un hôte',
        noConfigHosts: 'Aucun hôte nommé trouvé dans la configuration SSH.',
        address: 'Adresse SSH',
        advanced: 'Options avancées',
        label: 'Nom',
        directory: 'Répertoire distant',
        executable: 'Exécutable DSH',
        profile: 'Profil',
        remoteHome: 'Répertoire personnel distant',
        connected: 'Connecté',
        connecting: 'Connexion…',
        disconnected: 'Déconnecté',
        error: 'Échec de la connexion',
        checkingPlugin: 'Vérification de Session Harbor…',
        pluginSyncNote: 'À la connexion, Session Harbor est installé sur l’appareil distant s’il est absent. Les anciennes versions sont mises à jour vers la version locale.',
        pluginSyncFailed: 'Impossible d’installer Session Harbor {version} sur cet hôte. L’épinglage ou la clôture des sessions distantes peut être limité. Vérifiez pnpm et l’accès au registre, puis reconnectez-vous.',
        connect: 'Connecter',
        disconnect: 'Déconnecter',
        cancelConnection: 'Annuler la connexion',
        cancel: 'Annuler',
        remove: 'Supprimer',
        close: 'Fermer',
        removeQuestion: 'Supprimer {host} ?',
        removeActiveQuestion: 'Déconnecter et supprimer {host} ?',
        hostAction: '{action} ({host})',
        loading: 'Chargement des connexions SSH…',
        empty: 'Aucun hôte SSH enregistré.',
        refresh: 'Actualiser',
        refreshing: 'Actualisation…',
        retry: 'Réessayer',
        requiredHost: 'Saisissez une adresse SSH ou choisissez un hôte.',
        duplicate: 'Cet hôte SSH est déjà enregistré avec ces options.',
        requestFailed: 'Impossible de joindre le service SSH.',
        requestTimedOut: 'Le délai d’attente de la requête SSH a expiré.',
        httpError: 'Le service SSH a renvoyé le code HTTP {status}.',
        invalidResponse: 'Le service SSH a renvoyé une réponse non valide.',
      },
      de: {
        title: 'Session Harbor SSH',
        addHost: 'Host hinzufügen',
        addConnect: 'Hinzufügen und verbinden',
        adding: 'Wird hinzugefügt…',
        config: 'Hosts aus der SSH-Konfiguration',
        chooseHost: 'Host auswählen',
        noConfigHosts: 'Keine benannten Hosts in der SSH-Konfiguration gefunden.',
        address: 'SSH-Adresse',
        advanced: 'Erweiterte Optionen',
        label: 'Name',
        directory: 'Entferntes Verzeichnis',
        executable: 'Ausführbare DSH-Datei',
        profile: 'Profil',
        remoteHome: 'Entferntes Home-Verzeichnis',
        connected: 'Verbunden',
        connecting: 'Verbindung wird hergestellt…',
        disconnected: 'Getrennt',
        error: 'Verbindung fehlgeschlagen',
        checkingPlugin: 'Session Harbor wird geprüft…',
        pluginSyncNote: 'Beim Verbinden wird Session Harbor auf dem entfernten Gerät installiert, falls es fehlt. Ältere Versionen werden auf die lokale Version aktualisiert.',
        pluginSyncFailed: 'Session Harbor {version} konnte auf diesem Host nicht installiert werden. Anheften und Abschließen entfernter Sitzungen sind möglicherweise eingeschränkt. Prüfe pnpm und den Zugriff auf die Registry und stelle die Verbindung erneut her.',
        connect: 'Verbinden',
        disconnect: 'Trennen',
        cancelConnection: 'Verbindungsaufbau abbrechen',
        cancel: 'Abbrechen',
        remove: 'Löschen',
        close: 'Schließen',
        removeQuestion: '{host} löschen?',
        removeActiveQuestion: 'Verbindung zu {host} trennen und Host löschen?',
        hostAction: '{action} ({host})',
        loading: 'SSH-Verbindungen werden geladen…',
        empty: 'Keine gespeicherten SSH-Hosts.',
        refresh: 'Aktualisieren',
        refreshing: 'Wird aktualisiert…',
        retry: 'Erneut versuchen',
        requiredHost: 'Geben Sie eine SSH-Adresse ein oder wählen Sie einen Host aus.',
        duplicate: 'Dieser SSH-Host ist bereits mit diesen Optionen gespeichert.',
        requestFailed: 'Der SSH-Dienst war nicht erreichbar.',
        requestTimedOut: 'Das Zeitlimit für die SSH-Anfrage wurde überschritten.',
        httpError: 'Der SSH-Dienst hat den HTTP-Statuscode {status} zurückgegeben.',
        invalidResponse: 'Der SSH-Dienst hat eine ungültige Antwort zurückgegeben.',
      },
      ru: {
        title: 'Session Harbor SSH',
        addHost: 'Добавить хост',
        addConnect: 'Добавить и подключиться',
        adding: 'Добавление…',
        config: 'Хосты из конфигурации SSH',
        chooseHost: 'Выбрать хост',
        noConfigHosts: 'В конфигурации SSH нет именованных хостов.',
        address: 'Адрес SSH',
        advanced: 'Дополнительные параметры',
        label: 'Имя',
        directory: 'Удалённая папка',
        executable: 'Исполняемый файл DSH',
        profile: 'Профиль',
        remoteHome: 'Домашняя папка на удалённом устройстве',
        connected: 'Подключено',
        connecting: 'Подключение…',
        disconnected: 'Отключено',
        error: 'Не удалось подключиться',
        checkingPlugin: 'Проверяется Session Harbor…',
        pluginSyncNote: 'При подключении Session Harbor устанавливается на удалённое устройство, если плагина там нет. Старые версии обновляются до локальной версии.',
        pluginSyncFailed: 'Не удалось установить Session Harbor {version} на этом устройстве. Закрепление и завершение удалённых сессий могут быть ограничены. Проверьте pnpm и доступ к реестру, затем подключитесь снова.',
        connect: 'Подключиться',
        disconnect: 'Отключиться',
        cancelConnection: 'Отменить подключение',
        cancel: 'Отмена',
        remove: 'Удалить',
        close: 'Закрыть',
        removeQuestion: 'Удалить хост «{host}»?',
        removeActiveQuestion: 'Отключиться от хоста «{host}» и удалить его?',
        hostAction: '{action} ({host})',
        loading: 'Загрузка подключений SSH…',
        empty: 'Нет сохранённых хостов SSH.',
        refresh: 'Обновить',
        refreshing: 'Обновление…',
        retry: 'Повторить',
        requiredHost: 'Введите адрес SSH или выберите хост.',
        duplicate: 'Этот хост SSH уже сохранён с такими параметрами.',
        requestFailed: 'Служба SSH недоступна.',
        requestTimedOut: 'Истекло время ожидания ответа на запрос SSH.',
        httpError: 'Служба SSH вернула код HTTP {status}.',
        invalidResponse: 'Служба SSH вернула некорректный ответ.',
      },
      pt: {
        title: 'Session Harbor SSH',
        addHost: 'Adicionar host',
        addConnect: 'Adicionar e conectar',
        adding: 'Adicionando…',
        config: 'Hosts da configuração SSH',
        chooseHost: 'Escolher host',
        noConfigHosts: 'Nenhum host com nome foi encontrado na configuração SSH.',
        address: 'Endereço SSH',
        advanced: 'Opções avançadas',
        label: 'Nome',
        directory: 'Diretório remoto',
        executable: 'Executável do DSH',
        profile: 'Perfil',
        remoteHome: 'Pasta pessoal remota',
        connected: 'Conectado',
        connecting: 'Conectando…',
        disconnected: 'Desconectado',
        error: 'Falha na conexão',
        checkingPlugin: 'Verificando o Session Harbor…',
        pluginSyncNote: 'Ao conectar, o Session Harbor é instalado no dispositivo remoto se estiver ausente. Versões antigas são atualizadas para a versão local.',
        pluginSyncFailed: 'Não foi possível instalar o Session Harbor {version} neste host. Fixar e concluir sessões remotas pode ficar limitado. Verifique o pnpm e o acesso ao registro e tente se conectar novamente.',
        connect: 'Conectar',
        disconnect: 'Desconectar',
        cancelConnection: 'Cancelar conexão',
        cancel: 'Cancelar',
        remove: 'Excluir',
        close: 'Fechar',
        removeQuestion: 'Excluir {host}?',
        removeActiveQuestion: 'Desconectar e excluir {host}?',
        hostAction: '{action} ({host})',
        loading: 'Carregando conexões SSH…',
        empty: 'Nenhum host SSH salvo.',
        refresh: 'Atualizar',
        refreshing: 'Atualizando…',
        retry: 'Tentar novamente',
        requiredHost: 'Digite um endereço SSH ou escolha um host.',
        duplicate: 'Este host SSH já está salvo com essas opções.',
        requestFailed: 'Não foi possível acessar o serviço SSH.',
        requestTimedOut: 'A solicitação SSH excedeu o tempo limite.',
        httpError: 'O serviço SSH retornou HTTP {status}.',
        invalidResponse: 'O serviço SSH retornou uma resposta inválida.',
      },
      ['z' + 'h']: {
        title: 'Session Harbor SSH', addHost: '添加主机', addConnect: '添加并连接', adding: '正在添加…',
        config: 'SSH 配置中的主机', chooseHost: '选择主机', noConfigHosts: 'SSH 配置中未找到已命名的主机。',
        address: 'SSH 地址', advanced: '高级选项', label: '名称', directory: '远程目录',
        executable: 'DSH 启动路径', profile: '配置名称', remoteHome: '远程用户主目录',
        connected: '已连接', connecting: '连接中…', disconnected: '未连接', error: '连接失败',
        checkingPlugin: '正在检查 Session Harbor…',
        pluginSyncNote: '连接时会为远端安装缺失的 Session Harbor，或将旧版升级到本机版本。',
        pluginSyncFailed: '无法在此设备上安装 Session Harbor {version}。远端会话的置顶和完成操作可能受限。请检查远端的 pnpm 和 npm 源，再重新连接。',
        connect: '连接', disconnect: '断开连接', cancelConnection: '取消连接', cancel: '取消',
        remove: '删除', close: '关闭', removeQuestion: '删除 {host}？', removeActiveQuestion: '断开连接并删除 {host}？',
        hostAction: '{action}（{host}）', loading: '正在加载 SSH 连接…', empty: '暂无已保存的 SSH 主机。',
        refresh: '刷新', refreshing: '正在刷新…', retry: '重试', requiredHost: '请输入 SSH 地址或选择主机。',
        duplicate: '已使用相同的选项保存了此 SSH 主机。',
        requestFailed: '无法访问 SSH 服务。', requestTimedOut: 'SSH 请求超时。',
        httpError: 'SSH 服务返回了 HTTP {status}。', invalidResponse: 'SSH 服务返回了无效响应。',
      },
    };
    const sshCss = `
      ${pickerCss}
      .t3-ssh{container:t3-ssh / inline-size;box-sizing:border-box;min-width:0;padding:clamp(16px,3vw,24px);color:var(--dsw-alias-label-primary);font-size:14px;line-height:1.57}
      .t3-ssh p{margin:0}
      .t3-ssh-head,.t3-ssh-config-head,.t3-ssh-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
      .t3-ssh-head,.t3-ssh-config-head{justify-content:space-between}
      .t3-ssh-head h2{margin:0;font-size:16px;font-weight:600;line-height:24px}
      .t3-ssh-row{display:flex;align-items:center;flex-wrap:wrap;gap:8px 12px;padding:16px 0;border-bottom:.5px solid var(--dsw-alias-border-l2)}
      .t3-ssh-copy{flex:1 1 120px;min-width:0;overflow-wrap:anywhere}
      .t3-ssh-status,.t3-ssh-meta,.t3-ssh-field{font-size:12px;color:var(--dsw-alias-label-secondary)}
      .t3-ssh-status[data-status=connected]{color:var(--dsw-alias-state-success-primary)}
      .t3-ssh-status[data-status=connecting]{color:var(--dsw-alias-brand-primary)}
      .t3-ssh-status[data-status=error],.t3-ssh-error,button.t3-ssh-danger{color:var(--dsw-alias-state-error-primary)}
      .t3-ssh-warning{color:var(--dsw-alias-state-warn-label)}
      .t3-ssh-feedback{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-block:12px;overflow-wrap:anywhere}
      .t3-ssh-form{display:grid;gap:12px;padding:16px 0}
      .t3-ssh-field{display:grid;gap:5px;min-width:0}
      .t3-ssh-warnings{margin:0;padding-inline-start:16px;overflow-wrap:anywhere}
      .t3-ssh-fields:not([hidden]){display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,180px),1fr));gap:10px;margin-top:10px}
      .t3-ssh-form>.t3-ssh-actions{justify-content:flex-end}
      @container t3-ssh (width < 420px){.t3-ssh-row>.t3-ssh-copy{flex-basis:100%}.t3-ssh-row>.t3-ssh-actions{margin-inline-start:auto}}
`;

    const sshDefaults = { host: '', label: '', cwd: '', dshPath: '', profile: '' };
    const sshKey = target => JSON.stringify([target.host, target.cwd || '', target.dshPath || 'dsh', target.profile || 'web']);
    const sshLive = connection => connection?.status === 'connecting' || connection?.status === 'connected';
    const sshAddress = host => (host.user ? host.user + '@' : '') + (host.hostname || host.alias);
    const sshMessage = value => String(value ?? '')
      .replace(/([?&](?:token|auth|access_token|key)=)[^\s&#]+/gi, '$1[redacted]')
      .replace(/(bearer\s+)[^\s,;]+/gi, '$1[redacted]')
      .replace(/((?:token|password|authorization)["']?\s*[:=]\s*["']?)[^\s"',;]+/gi, '$1[redacted]');

    function installSshSettings(ctx) {
      ctx.effect(() => ctx.locale.register(SSH_SETTINGS_ID, sshCopy), 'session-harbor: SSH dictionaries');
      const t = ctx.locale.bind(SSH_SETTINGS_ID);
      const subscribe = ctx.locale.subscribe.bind(ctx.locale);
      const getLocale = ctx.locale.getSnapshot.bind(ctx.locale);
      const invalidResponse = () => new Error(t('invalidResponse'));

      async function request(signal, args) {
        const timeout = AbortSignal.timeout(15000);
        try {
          const response = await fetch('/api/t3-ssh', {
            method: args ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store',
            signal: AbortSignal.any([signal, timeout]),
            headers: args ? { 'content-type': 'application/json' } : undefined,
            body: args ? JSON.stringify(args) : undefined,
          });
          const result = await response.json().catch(() => null);
          signal.throwIfAborted();
          timeout.throwIfAborted();
          const detail = typeof result?.error === 'string' ? sshMessage(result.error) : '';
          if (!response.ok) throw new Error(errorWithDetail(t('httpError', { status: response.status }), detail));
          if (detail) throw new Error(errorWithDetail(t('invalidResponse'), detail));
          if (!result || typeof result !== 'object' || Array.isArray(result)) throw invalidResponse();
          return result;
        } catch (failure) {
          signal.throwIfAborted();
          if (timeout.aborted) throw new Error(t('requestTimedOut'));
          if (failure instanceof TypeError) throw new Error(t('requestFailed'));
          throw failure;
        }
      }

      function SshSettings() {
        React.useSyncExternalStore(subscribe, getLocale, getLocale);
        const formId = React.useId();
        const [snapshot, setSnapshot] = React.useState(null);
        const [loadError, setLoadError] = React.useState('');
        const [error, setError] = React.useState('');
        const [busy, setBusy] = React.useState('');
        const [adding, setAdding] = React.useState(false);
        const [advanced, setAdvanced] = React.useState(false);
        const [draft, setDraft] = React.useState(sshDefaults);
        const [removeId, setRemoveId] = React.useState('');
        const sessionRef = React.useRef(null);
        const addressInput = React.useRef(null);
        const addButton = React.useRef(null);
        const restoreAddFocus = React.useRef(false);

        async function load(signal, args) {
          const next = await request(signal, args);
          signal.throwIfAborted();
          if (!Array.isArray(next.config?.hosts) || !Array.isArray(next.config?.warnings)
            || !Array.isArray(next.targets) || !Array.isArray(next.connections)) throw invalidResponse();
          setSnapshot(next);
          setLoadError('');
        }

        React.useEffect(() => {
          const lifetime = new AbortController();
          const session = { signal: lifetime.signal, poll: null, busy: false };
          sessionRef.current = session;
          const poll = async () => {
            if (session.signal.aborted || session.busy || session.poll || document.visibilityState === 'hidden') return;
            const controller = new AbortController();
            session.poll = controller;
            const signal = AbortSignal.any([session.signal, controller.signal]);
            try { await load(signal); }
            catch (failure) { if (!signal.aborted) setLoadError(failure.message); }
            finally { session.poll = null; }
          };
          void poll();
          const timer = setInterval(poll, 2000);
          document.addEventListener('visibilitychange', poll);
          return () => {
            lifetime.abort();
            clearInterval(timer);
            document.removeEventListener('visibilitychange', poll);
          };
        }, []);
        React.useEffect(() => { if (adding) addressInput.current?.focus(); }, [adding]);
        React.useEffect(() => {
          if (adding || busy || !restoreAddFocus.current) return;
          restoreAddFocus.current = false;
          addButton.current?.focus();
        }, [adding, busy]);

        const run = async (action, operation) => {
          const session = sessionRef.current;
          if (!session || session.signal.aborted || session.busy) return;
          session.busy = true;
          session.poll?.abort();
          setBusy(action);
          setError('');
          try { await operation(session.signal); }
          catch (failure) {
            if (!session.signal.aborted) {
              const setFailure = action === 'retry' ? setLoadError : setError;
              setFailure(failure.message);
            }
          } finally {
            session.busy = false;
            if (!session.signal.aborted) setBusy('');
          }
        };
        const hosts = snapshot?.config.hosts ?? [];
        const targets = snapshot?.targets ?? [];
        const connections = snapshot?.connections ?? [];
        const byKey = new Map();
        const savedKeys = new Set(targets.map(sshKey));
        for (const connection of connections) {
          const key = sshKey(connection);
          if (sshLive(connection) || !sshLive(byKey.get(key))) byKey.set(key, connection);
        }
        const rows = targets.map(target => ({ target, connection: byKey.get(sshKey(target)) }));
        for (const [key, connection] of byKey) {
          if (sshLive(connection) && !savedKeys.has(key)) rows.push({ connection });
        }
        const closeAdd = () => {
          restoreAddFocus.current = true;
          setAdding(false);
        };
        const updateConnection = result => {
          const connection = result.connection;
          if (typeof connection?.id !== 'string' || !connection.id) throw invalidResponse();
          setSnapshot(current => ({ ...current, connections: [...current.connections.filter(item => item.id !== connection.id), connection] }));
        };
        const submit = event => {
          event.preventDefault();
          const target = {
            host: draft.host.trim(), label: draft.label.trim(), cwd: draft.cwd.trim(),
            dshPath: draft.dshPath.trim() || 'dsh', profile: draft.profile.trim() || 'web',
          };
          if (!target.host) {
            setError(t('requiredHost'));
            addressInput.current?.focus();
            return;
          }
          if (savedKeys.has(sshKey(target))) {
            setError(t('duplicate'));
            return;
          }
          target.label ||= target.host;
          void run('add', async signal => {
            const { target: saved } = await request(signal, { action: 'save', target });
            if (typeof saved?.id !== 'string' || !saved.id) throw invalidResponse();
            setSnapshot(current => ({ ...current, targets: [...current.targets.filter(item => item.id !== saved.id), saved] }));
            closeAdd();
            updateConnection(await request(signal, { action: 'connect', id: saved.id }));
          });
        };
        const changeConnection = (action, id) => run(action, async signal => {
          updateConnection(await request(signal, { action, id }));
        });
        const remove = target => run('remove', async signal => {
          const result = await request(signal, { action: 'remove', id: target.id });
          if (typeof result.removed !== 'boolean') throw invalidResponse();
          const key = sshKey(target);
          setSnapshot(current => ({
            ...current, targets: current.targets.filter(item => item.id !== target.id),
            connections: current.connections.filter(item => sshKey(item) !== key),
          }));
          restoreAddFocus.current = true;
          setRemoveId('');
        });

        const button = (label, onClick, props = {}) => h(Button, {
          type: 'button', variant: 'outline', size: 'sm', onClick, disabled: !!busy, ...props,
        }, label);
        const hostAction = (action, host) => t('hostAction', { action, host });
        const hostRow = ({ target, connection }) => {
          const { host, label: savedLabel, profile, cwd, dshPath } = target ?? connection;
          const name = savedLabel || host;
          const configHost = hosts.find(item => item.alias === host);
          const address = configHost ? sshAddress(configHost) : host;
          const details = [address !== name && address, profile !== 'web' && profile, cwd, dshPath !== 'dsh' && dshPath].filter(Boolean).join(' · ');
          const status = connection?.status || 'disconnected';
          const statusLabel = connection?.phase === 'syncing-plugin' ? t('checkingPlugin') : t(status);
          const pluginWarning = connection?.pluginSyncFailedVersion
            ? t('pluginSyncFailed', { version: connection.pluginSyncFailedVersion }) : '';
          const live = sshLive(connection);
          const action = live ? 'disconnect' : 'connect';
          const label = t(status === 'connecting' ? 'cancelConnection' : action);
          return h('div', { key: target?.id ?? connection.id, className: 't3-ssh-row' },
            h('div', { className: 't3-ssh-copy' },
              h('div', { className: 't3-ssh-name' }, name),
              details && h('div', { className: 't3-ssh-meta' }, details),
              connection?.error && h('p', { className: 't3-ssh-meta t3-ssh-error' }, sshMessage(connection.error)),
              h('p', { className: 't3-ssh-meta t3-ssh-warning', role: 'status' }, pluginWarning)),
            h('span', { className: 't3-ssh-status', 'data-status': status, role: 'status' }, statusLabel),
            h('div', { className: 't3-ssh-actions' },
              button(label, () => changeConnection(action, live ? connection.id : target.id), {
                'aria-label': hostAction(label, name), variant: live ? 'outline' : 'primary',
              }),
              target && button(t('remove'), () => { setError(''); setRemoveId(target.id); }, {
                'aria-label': hostAction(t('remove'), name), 'aria-haspopup': 'dialog', variant: 'ghost',
              })));
        };
        const fieldProps = name => ({
          value: draft[name], disabled: !!busy, autoComplete: 'off', spellCheck: false,
          onChange: event => setDraft(current => ({ ...current, [name]: event.target.value })),
        });
        const advancedField = (name, label, placeholder) => h('label', { className: 't3-ssh-field' }, t(label),
          h(Input, { ...fieldProps(name), placeholder, maxLength: name === 'label' ? 120 : 4096 }));
        const configHost = hosts.find(host => host.alias === draft.host);
        const configItems = hosts.map(host => {
          const address = sshAddress(host);
          return { id: host.alias, label: address === host.alias ? host.alias : host.alias + ' · ' + address };
        });
        const removing = rows.find(row => row.target?.id === removeId);
        const cancelRemove = () => { if (!busy) { setError(''); setRemoveId(''); } };
        return h('section', { className: 't3-ssh', 'aria-labelledby': formId },
          h('style', null, sshCss),
          h('div', { className: 't3-ssh-head' }, h('h2', { id: formId }, t('title')),
            !adding && button(t('addHost'), () => {
              setDraft(sshDefaults); setError(''); setRemoveId(''); setAdvanced(false); setAdding(true);
            }, { ref: addButton, disabled: !!busy || !snapshot, icon: h(IconPlusOutlineRegular, { size: 14 }) })),
          h('p', { className: 't3-ssh-meta' }, t('pluginSyncNote')),
          loadError && h('div', { className: 't3-ssh-feedback', role: 'alert' }, h('span', { className: 't3-ssh-error' }, loadError),
            button(t('retry'), () => run('retry', signal => load(signal)))),
          error && !removing && h('p', { className: 't3-ssh-feedback t3-ssh-error', role: 'alert' }, error),
          rows.length > 0 && h('div', { className: 't3-ssh-list' }, rows.map(hostRow)),
          !snapshot && !loadError && h('p', { className: 't3-ssh-meta', role: 'status' }, t('loading')),
          snapshot && !rows.length && !adding && h('p', { className: 't3-ssh-meta' }, t('empty')),
          adding && h('form', { className: 't3-ssh-form', onSubmit: submit },
            h('div', { className: 't3-ssh-field' },
              h('div', { className: 't3-ssh-config-head' },
                h('span', null, t('config')),
                button(t(busy === 'refresh' ? 'refreshing' : 'refresh'), () => run('refresh', signal => load(signal, { action: 'refresh' })), { variant: 'ghost' })),
              hosts.length ? h(PickerMenu, {
                text: configHost?.alias ?? t('chooseHost'), label: t('config'), items: configItems, selectedId: configHost?.alias,
                disabled: !!busy, onSelect: host => setDraft(current => ({ ...current, host })),
              }) : h('p', null, t('noConfigHosts')),
              snapshot.config.warnings.length > 0 && h('ul', { className: 't3-ssh-warnings' },
                snapshot.config.warnings.map((warning, index) => h('li', { key: index }, sshMessage(warning))))),
            h('label', { className: 't3-ssh-field' }, t('address'),
              h(Input, { ...fieldProps('host'), ref: addressInput, placeholder: 'user@host', maxLength: 512, autoCapitalize: 'none' })),
            h('div', null,
              button(t('advanced'), () => setAdvanced(!advanced), {
                variant: 'ghost', 'aria-expanded': advanced, 'aria-controls': formId + '-advanced',
                icon: h(advanced ? IconChevronDownOutlineRegular : IconChevronRightOutlineRegular, { size: 14 }),
              }),
              h('div', { id: formId + '-advanced', className: 't3-ssh-fields', hidden: !advanced },
                advancedField('label', 'label'), advancedField('cwd', 'directory', t('remoteHome')),
                advancedField('dshPath', 'executable', 'dsh'), advancedField('profile', 'profile', 'web'))),
            h('div', { className: 't3-ssh-actions' },
              button(t('cancel'), () => { closeAdd(); setError(''); }),
              button(t(busy === 'add' ? 'adding' : 'addConnect'), undefined, { type: 'submit', variant: 'primary' }))),
          removing && h(Modal, {
            open: true, title: t('remove'), closeLabel: t('close'), onClose: cancelRemove,
            description: t(sshLive(removing.connection) ? 'removeActiveQuestion' : 'removeQuestion', { host: removing.target.label || removing.target.host }),
            footer: h(React.Fragment, null,
              button(t('cancel'), cancelRemove, { 'data-modal-autofocus': true }),
              button(t('remove'), () => remove(removing.target), { className: 't3-ssh-danger' })),
          }, error && h('p', { className: 't3-ssh-error', role: 'alert' }, error)));
      }

      ctx.effect(() => ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section', id: SSH_SETTINGS_ID, order: 26, label: () => t('title'),
      }, SshSettings)), 'session-harbor: SSH settings section');
      ctx.effect(() => ctx.slots.inject('settings.section.icon', () => ctx.slots.register({
        name: 'settings.section.icon', id: SSH_SETTINGS_ID,
      }, MachineIcon)), 'session-harbor: SSH settings icon');
    }

    return {
      inject: ['slots', 'locale', 'connection', 'uiWorkspace', 'contextMenus', 'workspaces', 'loader', 'modules', 'layout', 'sessions', 'uiSession', 'shortcuts', 'remote.commands'],
      apply(ctx) {
        Sidebar.context = ctx;
        runtimeClosed = false;
        ctx.effect(() => ctx.locale.register(NS, dictionaries), 'session-harbor: dictionaries');
        installSshSettings(ctx);
        ctx.slots.inject('contextMenu.icon', function* () {
          yield ctx.slots.register({ name: 'contextMenu.icon', key: NS + '.settle' }, SettledIcon);
          yield ctx.slots.register({ name: 'contextMenu.icon', key: NS + '.unsettle' }, () => h(SettledIcon, { restored: true }));
        });
        ctx.effect(() => ctx.contextMenus.register({
          id: 't3-sidebar.settled', target: 'session', order: 150,
          observe: () => [ctx.locale, ctx.workspaces.list],
          async resolve(target, signal) {
            const workspaceList = ctx.get('workspaces')?.list?.getSnapshot();
            if (!workspaceList || workspaceList.archivedSessionIds.includes(target.sessionId)) return [];
            // A failed or slow sidecar must not prevent the built-in menu from
            // opening. The menu simply omits this contribution until it recovers.
            const abort = new AbortController();
            const cancel = () => abort.abort();
            if (signal.aborted) return [];
            signal.addEventListener('abort', cancel, { once: true });
            const timer = setTimeout(cancel, 350);
            let snapshot;
            try {
              snapshot = unwrap(await ctx.connection.rpc.call('/api', 't3-session-sidebar/snapshot', {}, abort.signal));
              if (!validSnapshot(snapshot)) return [];
            } catch { return []; }
            finally { clearTimeout(timer); signal.removeEventListener('abort', cancel); }
            const settled = !!snapshot.placements[target.sessionId]?.settled;
            const action = settled ? 'unsettle' : 'settle';
            const t = ctx.locale.bind(NS);
            return [{
              id: 'settled', label: t(action), icon: { key: NS + '.' + action },
              failureLabel: t('actionFailed'),
              async run() {
                // The menu's preparation signal ends on dismissal; an action
                // owns its own request after selection.
                if (ctx.workspaces.list.getSnapshot().archivedSessionIds.includes(target.sessionId)) throw new Error('Session is archived');
                const current = unwrap(await ctx.connection.rpc.call('/api', 't3-session-sidebar/snapshot', {}));
                if (!validSnapshot(current)) throw new Error('Invalid session placement');
                if (!!current.placements[target.sessionId]?.settled !== settled) throw new Error('Session placement changed');
                unwrap(await ctx.connection.rpc.call('/api', 't3-session-sidebar/action', { sessionId: target.sessionId, action }));
                ctx.contextMenus.notify(t(settled ? 'menuRestored' : 'menuDone'), true);
              },
            }];
          },
        }), 'session-harbor: session menu');
        ctx.effect(() => ctx.contextMenus.register({
          id: 't3-sidebar.device-session', target: 't3-device-session', order: 100,
          observe: () => [ctx.locale, {
            getSnapshot: () => mirrorState,
            subscribe(listener) { mirrorListeners.add(listener); return () => mirrorListeners.delete(listener); },
          }],
          resolve(target) {
            const row = mirrorState.snapshot?.sessions?.[target.targetId + '/' + target.sessionId];
            const machine = currentMachine(target.targetId);
            if (!row || !machine) return [];
            const t = ctx.locale.bind(NS);
            const online = canManageDevice(target.targetId);
            const placement = online && Number.isInteger(mirrorState.snapshot?.contract) && machine.pluginContract === mirrorState.snapshot.contract;
            const verb = action => async () => {
              requireRemoteReady(target.targetId);
              await remoteCall('t3-remote/action', { targetId: target.targetId, sessionId: target.sessionId, action });
              refreshMirror();
            };
            const item = (id, label, run, disabled = false) => ({ id, label: t(label), run, disabled, failureLabel: t('actionFailed') });
            return [
              item('open', 'remoteOpen', () => openDeviceSession({ targetId: target.targetId, sessionId: target.sessionId }), !canOpenDevice(target.targetId)),
              item('pin', row.pinned ? 'unpin' : 'pin', verb(row.pinned ? 'unpin' : 'pin'), !placement),
              item('settle', row.settled ? 'unsettle' : 'settle', verb(row.settled ? 'unsettle' : 'settle'), !placement),
              item('rename', 'rename', () => { requireRemoteReady(target.targetId); setRenameTarget({ ...target, displayTitle: row.displayTitle || '' }); }, !online),
              item('fork', 'fork', async () => {
                const signal = ctx.layout.beginNavigation();
                let value;
                try {
                  await prepareRemoteNavigation(target.targetId, signal);
                  value = await remoteSessionCommand(target, 'fork', undefined, signal);
                } catch (error) {
                  if (signal.aborted) return;
                  throw error;
                }
                const sessionId = value.sessionId ?? value.session?.sessionId;
                if (!sessionId) throw new Error(t('openFailed'));
                if (!signal.aborted) await openDeviceSession({ targetId: target.targetId, sessionId });
              }, !online),
              item('copy', 'copyId', async () => {
                if (!navigator.clipboard?.writeText) throw new Error(t('actionFailed'));
                await navigator.clipboard.writeText(target.sessionId);
                ctx.contextMenus.notify(t('copyDone'), true);
              }),
              { ...item('archive', 'archive', async () => {
                await remoteSessionCommand(target, 'archive');
                const active = runtimeSnapshot.active;
                if (active?.targetId === target.targetId && active.sessionId === target.sessionId) chooseDeviceProject(target.targetId);
              }, !online), separatorBefore: true },
            ];
          },
        }), 'session-harbor: device session menu');
        ctx.effect(() => ctx.slots.inject('main', function* () {
          yield ctx.slots.register({ name: 'main', key: DEVICE_PANEL, locale: NS }, DeviceConversation);
          yield ctx.slots.register({ name: 'main', key: NEW_PANEL, locale: NS }, NewDeviceSession);
        }), 'session-harbor: device main regions');
        ctx.effect(() => ctx.slots.inject('shell.overlay', function* () {
          yield ctx.slots.register({ name: 'shell.overlay', id: 't3-device-runtime-owner' }, RuntimeConnections);
          yield ctx.slots.register({ name: 'shell.overlay', id: 't3-device-rename', locale: NS }, RemoteRenameOverlay);
        }), 'session-harbor: device overlays');
        ctx.effect(() => installDeviceWorkspacePicker(ctx), 'session-harbor: device before project');
        ctx.effect(() => observeWorkspaceStarts(ctx.uiWorkspace, null), 'session-harbor: remember new sessions');
        ctx.effect(() => installSessionOpenNotice(ctx), 'session-harbor: session open notice');
        ctx.effect(() => async () => {
          runtimeClosed = true;
          navigation++;
          stopPool();
          const previous = pool;
          pool = null;
          await previous?.dispose();
          publishRuntime({ pool: null, active: null, phase: 'idle', error: null });
          setRenameTarget(null);
        }, 'session-harbor: device runtime ownership');
        ctx.effect(() => {
          let enabled = true;
          let disposeSidebar;
          const listeners = new Set();
          const subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener); };
          const install = () => {
            const dispose = ctx.slots.inject('sidebar.workspaces', () => ctx.slots.register({ name: 'sidebar.workspaces', priority: -1000, locale: NS }, Sidebar));
            const restore = wrapWorkspaceMethod(ctx.uiWorkspace, 'startSession', original => function(workspaceId, options) {
              if (workspaceId === undefined && options === undefined && startLastNewSession()) return;
              return original.call(this, workspaceId, options);
            });
            return () => { restore(); dispose?.(); };
          };
          const toggle = () => {
            enabled = !enabled;
            if (enabled) disposeSidebar = install();
            else { disposeSidebar?.(); disposeSidebar = undefined; }
            listeners.forEach(listener => listener());
          };
          function Footer({ t, wide }) {
            const active = React.useSyncExternalStore(subscribe, () => enabled, () => enabled);
            const label = t(active ? 'native' : 'enable');
            return h(React.Fragment, null, h('style', null, css), h('button', { type: 'button', className: 't3-btn t3-footer', 'data-wide': wide, onClick: toggle, title: label, 'aria-label': label }, h(SwitchSidebarIcon), wide && h('span', { className: 't3-footer-label' }, active ? t('nativeShort') : label)));
          }
          disposeSidebar = install();
          const disposeFooter = ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({ name: 'sidebar.footer.action', id: 't3-session-sidebar-toggle-v8', order: 1000, locale: NS }, Footer));
          return () => { disposeSidebar?.(); disposeFooter?.(); listeners.clear(); };
        }, 'session-harbor: slots');
      }
    };
  }
});
