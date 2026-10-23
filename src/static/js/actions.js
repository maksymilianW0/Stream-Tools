import { toast } from "./util.js";
import { CFG } from "./config.js";

/* Akcje: reguły „gdy zdarzenie → wykonaj akcje". Reguły leżą w CFG.pad.actions
   (config.json na serwerze), więc są wspólne dla wszystkich urządzeń. */

export const TRIGGERS={
  scene_enter:"Wybrano scenę",
  scene_leave:"Opuszczono scenę",
  stream_start:"Rozpoczęto stream",
  stream_stop:"Zakończono stream",
  record_start:"Rozpoczęto nagrywanie",
  record_stop:"Zakończono nagrywanie"
};
export const ACTION_LABELS={
  mute:"Wycisz źródło",
  unmute:"Włącz dźwięk źródła",
  volume:"Ustaw głośność źródła",
  scene:"Przełącz scenę",
  rec_start:"Rozpocznij nagrywanie",
  rec_stop:"Zakończ nagrywanie"
};

export const isSceneTrigger=t=>t==="scene_enter"||t==="scene_leave";
export const needsTarget=t=>t==="mute"||t==="unmute"||t==="volume"||t==="scene";

const q=n=>"„"+n+"”";
export function describeTrigger(t){
  const base=(TRIGGERS[t.type]||t.type).toLowerCase();
  return t.scene?`${base} ${q(t.scene)}`:base;
}
export function describeAction(a){
  switch(a.type){
    case "mute": return "Wycisz "+q(a.target);
    case "unmute": return "Włącz dźwięk "+q(a.target);
    case "volume": return `Ustaw głośność ${q(a.target)} na ${a.value}%`;
    case "scene": return "Przełącz na scenę "+q(a.target);
    case "rec_start": return "Rozpocznij nagrywanie";
    case "rec_stop": return "Zakończ nagrywanie";
  }
  return a.type;
}

/**
 * Wykonawca reguł. Używa wyłącznie poleceń idempotentnych (wycisz / włącz dźwięk,
 * ustaw głośność, przełącz scenę, start/stop nagrywania ze sprawdzeniem stanu),
 * bo ten sam pad może być otwarty na kilku urządzeniach naraz i każde wykona regułę.
 */
export function createActionRunner({obs,state,applyRecordSettings}){
  const lastFired=new Map();

  async function run(a){
    switch(a.type){
      case "mute": return obs.req("SetInputMute",{inputName:a.target,inputMuted:true});
      case "unmute": return obs.req("SetInputMute",{inputName:a.target,inputMuted:false});
      case "volume": return obs.req("SetInputVolume",{inputName:a.target,inputVolumeMul:Math.pow(a.value/100,3)});
      case "scene": return obs.req("SetCurrentProgramScene",{sceneName:a.target});
      case "rec_start":
        if(state.recording) return;
        await applyRecordSettings();
        return obs.req("StartRecord");
      case "rec_stop":
        if(!state.recording) return;
        return obs.req("StopRecord");
    }
  }

  async function runRule(rule){
    for(const a of rule.actions){
      try{ await run(a); }
      catch(e){
        // drugie urządzenie mogło już włączyć/wyłączyć nagrywanie: to nie błąd
        if((a.type==="rec_start"||a.type==="rec_stop")&&e.fromObs) continue;
        toast(`Akcja „${describeAction(a)}” nie powiodła się: ${e.message}`);
      }
    }
  }

  function fire(type,scene){
    const now=Date.now();
    for(const rule of CFG.pad.actions||[]){
      if(!rule.enabled||rule.trigger.type!==type) continue;
      if(isSceneTrigger(type)&&rule.trigger.scene!==scene) continue;
      if(now-(lastFired.get(rule.id)||0)<800) continue; // ochrona przed pętlą scena A → B → A
      lastFired.set(rule.id,now);
      runRule(rule);
    }
  }

  return {fire};
}
