/**
 *
 * Reldens - RoomEvents
 *
 * This class will listen the scene-rooms and run the related actions, it will also register the other modules action
 * into the room events.
 *
 */

const { PlayerEngine } = require('../../users/client/player-engine');
const { SceneDynamic } = require('./scene-dynamic');
const { ScenePreloader } = require('./scene-preloader');
const { GameConst } = require('../constants');

class RoomEvents
{

    room = false;
    sceneData = false;
    playersQueue = {};

    constructor(roomName, gameManager)
    {
        this.gameManager = gameManager;
        this.gameEngine = gameManager.gameEngine;
        this.roomName = roomName;
    }

    activateRoom(room, previousScene = false)
    {
        this.room = room;
        // listen to changes coming from the server:
        this.room.state.players.onAdd = (player, key) => {
            this.playersOnAdd(player, key, previousScene);
        };
        this.room.state.players.onChange = (player, key) => {
            this.playersOnChange(player, key);
        };
        this.room.state.players.onRemove = (player, key) => {
            this.playersOnRemove(player, key);
        };
        // create players or change scenes:
        this.room.onMessage((message) => {
            if(
                message.act === GameConst.CHANGED_SCENE
                && message.scene === this.room.name
                && this.room.sessionId !== message.id
            ){
                let currentScene = this.getActiveScene();
                // if other users enter in the current scene we need to add them:
                let {id, x, y, dir} = message;
                currentScene.player.addPlayer(id, {x: x, y: y, dir: dir});
            }
            // @NOTE: here we don't need to evaluate the id since the reconnect only is sent to the current client.
            if(message.act === GameConst.RECONNECT){
                this.gameManager.reconnectGameClient(message, this.room);
            }
            // @NOTE: now this method will update the stats every time the stats action is received but the UI will be
            // created only once in the preloader.
            if(message.act === GameConst.PLAYER_STATS){
                this.activatePlayerStats(message);
            }
        });
        this.room.onLeave((code) => {
            if (code > 1000) {
                // @TODO: replace this by a proper disconnection handler.
                // server error, disconnection:
                alert('There was a connection error.');
                window.location.reload();
            } else {
                // the client has initiated the disconnection, remove the scene:
                // this.gameEngine.scene.remove(this.roomName);
            }
        });
        // @NOTE: here we attach features onMessage actions for the events on the scene-rooms, we may need to do this
        // for every room state change, not only for onMessage but for room.state.onChange, onRemove, onAdd as well.
        this.gameManager.features.attachOnMessageObserversToRoom(this);
    }

    playersOnAdd(player, key, previousScene)
    {
        if(this.room.state && (!this.sceneData || this.room.state !== this.sceneData)){
            this.sceneData = JSON.parse(this.room.state.sceneData);
        }
        // create current player:
        if(key === this.room.sessionId){
            this.engineStarted = true;
            this.startEngineScene(player, this.room, previousScene);
            let currentScene = this.getActiveScene();
            if(currentScene.key === player.state.scene && currentScene.player && currentScene.player.players){
                for(let idx in this.playersQueue){
                    let { x, y, dir } = this.playersQueue[idx];
                    currentScene.player.addPlayer(idx, { x, y, dir });
                }
            }
        } else {
            // add new players into the current player scene:
            if(this.engineStarted){
                let currentScene = this.getActiveScene();
                if(currentScene.key === player.state.scene && currentScene.player && currentScene.player.players){
                    let { x, y, dir } = player.state;
                    currentScene.player.addPlayer(key, { x, y, dir });
                }
            } else {
                let { x, y, dir } = player.state;
                this.playersQueue[key] = { x, y, dir };
            }
        }
    }

    playersOnChange(player, key)
    {
        // do not move the player if is changing scene:
        if(player.state.scene !== this.roomName){
            return;
        }
        let currentScene = this.getActiveScene();
        if(currentScene.player && {}.hasOwnProperty.call(currentScene.player.players, key)){
            currentScene.player.runPlayerAnimation(key, player);
        }
    }

    playersOnRemove(player, key)
    {
        if(key === this.room.sessionId){
            // @TODO: replace this by a proper disconnection handler.
            alert('Your session ended, please login again.');
            window.location.reload();
        } else {
            let currentScene = this.getActiveScene();
            if(currentScene.player && {}.hasOwnProperty.call(currentScene.player.players, key)){
                // remove your player entity from the game world:
                currentScene.player.removePlayer(key);
            }
        }
    }

    activatePlayerStats(message)
    {
        let uiScene = this.gameEngine.uiScene;
        let currentScene = this.getActiveScene();
        if(currentScene.player && {}.hasOwnProperty.call(currentScene.player.players, this.room.sessionId)){
            let playerSprite = currentScene.player.players[this.room.sessionId];
            playerSprite.stats = message.stats;
        }
        if(uiScene && {}.hasOwnProperty.call(uiScene, 'uiBoxPlayerStats')){
            let statsPanel = uiScene.uiBoxPlayerStats.getChildByProperty('id', 'player-stats-container');
            if(statsPanel){
                let messageTemplate = uiScene.cache.html.get('playerStats');
                // @TODO: stats types will be part of the configuration in the database.
                statsPanel.innerHTML = this.gameManager.gameEngine.TemplateEngine.render(messageTemplate, {
                    stats: message.stats
                });
            }
        }
    }

    startEngineScene(player, room, previousScene = false)
    {
        let preloaderName = GameConst.SCENE_PRELOADER+this.sceneData.roomName;
        let uiScene = false;
        if(!this.gameEngine.uiScene){
            uiScene = true;
        }
        // @TODO: implement player custom avatar.
        // , player.username
        let scenePreloader = this.createPreloaderInstance({
            name: preloaderName,
            map: this.sceneData.roomMap,
            images: this.sceneData.sceneImages,
            uiScene: uiScene,
            gameManager: this.gameManager,
            preloadAssets: this.sceneData.preloadAssets,
            objectsAnimationsData: this.sceneData.objectsAnimationsData
        });
        if(!this.gameEngine.scene.getScene(preloaderName)){
            this.gameEngine.scene.add(preloaderName, scenePreloader, true);
            let preloader = this.gameEngine.scene.getScene(preloaderName);
            preloader.load.on('complete', () => {
                // set ui on first preloader scene:
                if(!this.gameEngine.uiScene){
                    // assign the preloader:
                    this.gameEngine.uiScene = preloader;
                    // if the box right is present then assign the actions:
                    if(preloader.uiBoxRight){
                        let element = preloader.uiBoxRight.getChildByProperty('className', 'player-name');
                        if(element){
                            element.innerHTML = player.username;
                        }
                    }
                }
                this.createEngineScene(player, room, previousScene, this.sceneData);
            });
        } else {
            this.createEngineScene(player, room, previousScene, this.sceneData);
        }
    }

    createEngineScene(player, room, previousScene, sceneData)
    {
        if(!this.gameEngine.scene.getScene(player.state.scene)){
            let engineSceneDynamic = this.createSceneInstance(player.state.scene, sceneData, this.gameManager);
            this.gameEngine.scene.add(player.state.scene, engineSceneDynamic, false);
        }
        if(!this.gameManager.room){
            this.gameEngine.scene.start(player.state.scene);
        } else {
            if(previousScene && this.gameEngine.scene.getScene(previousScene)){
                // destroy previous scene tileset:
                this.gameEngine.scene.getScene(previousScene).changeScene();
                // stop the previous scene and start the new one:
                this.gameEngine.scene.stop(previousScene);
                this.gameEngine.scene.start(player.state.scene);
            }
        }
        this.gameManager.room = room;
        let currentScene = this.gameEngine.scene.getScene(player.state.scene);
        currentScene.player = this.createPlayerEngineInstance(currentScene, player, this.gameManager.config, room);
        currentScene.player.create();
        if(room.state.players){
            for(let idx in room.state.players){
                let tmp = room.state.players[idx];
                if(tmp.sessionId && tmp.sessionId !== room.sessionId){
                    let { x, y, dir } = tmp.state;
                    currentScene.player.addPlayer(tmp.sessionId, { x, y, dir });
                }
            }
        }
        // update any ui if needed, this event happens once for every scene:
        let uiScene = this.gameEngine.uiScene;
        // if scene label is visible assign the data to the box:
        if({}.hasOwnProperty.call(uiScene, 'uiSceneLabel')){
            let element = uiScene.uiSceneLabel.getChildByProperty('className', 'scene-label');
            if(element){
                element.innerHTML = this.sceneData.roomTitle;
            }
        }
        // @NOTE: player states must be requested since are private user data that we can share with other players or
        // broadcast to the rooms.
        // request player stats after the player was added to the scene:
        this.room.send({act: GameConst.PLAYER_STATS});
        // send notification about client joined:
        this.room.send({act: GameConst.CLIENT_JOINED});
    }

    // @TODO: - Seiyria - this function would really benefit from guards. it's just two nested if statements that could
    //   be moved to the top and cleaned up, like so-
    /*
    if(this.gameEngine.scene.getScene(this.roomName)) return ...;

    if(!this.sceneData) return;

    ...
    */
    getActiveScene()
    {
        if(!this.gameEngine.scene.getScene(this.roomName)){
            if(this.sceneData){
                let engineSceneDynamic = this.createSceneInstance(this.roomName, this.sceneData, this.gameManager);
                this.gameEngine.scene.add(this.roomName, engineSceneDynamic, false);
            }
        }
        return this.gameEngine.scene.getScene(this.roomName);
    }

    createSceneInstance(sceneName, sceneData, gameManager)
    {
        return new SceneDynamic(sceneName, sceneData, gameManager);
    }

    createPlayerEngineInstance(currentScene, player, config, room)
    {
        return new PlayerEngine(currentScene, player, config, room);
    }

    createPreloaderInstance(props)
    {
        return new ScenePreloader(props);
    }

}

module.exports.RoomEvents = RoomEvents;
