import React, { useState, useRef, useCallback, useEffect } from "react";
import Layout from "../components/Layout";
import Webcam from "react-webcam";
import { Camera, CheckCircle, Clock, Briefcase, Plus, User, Tag, Key, X, Trash2, History, Lock, LogIn, LogOut } from "lucide-react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { getBusiness, getEmployees, createEmployee, deleteEmployee, getTimeLogs, clockIn, clockOut, getEmployeeStatus, Employee } from "../services/db";
import { matchFaces, identifyFace, loadFaceModels, hasDetectableFace } from "../lib/face";

export default function Employees() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<'list' | 'pointage' | 'historique'>('list');
  const [pointageStatus, setPointageStatus] = useState<'idle' | 'capturing' | 'verifying' | 'success'>('idle');
  const [pointageError, setPointageError] = useState("");
  const [pointageEmployeeId, setPointageEmployeeId] = useState<string>('');
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [timeLogs, setTimeLogs] = useState<any[]>([]);
  const [historyFilter, setHistoryFilter] = useState("");
  const [histPeriod, setHistPeriod] = useState<'jour' | 'semaine' | 'mois' | 'tout'>('mois');
  const [histDate, setHistDate] = useState(new Date().toISOString().split('T')[0]);
  const [role, setRole] = useState<string>('admin');
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [formError, setFormError] = useState("");
  const [businessId, setBusinessId] = useState<number | null>(null);
  // Pour le rôle 'employee' : cet identifiant est le SEUL qu'il peut pointer —
  // pas de liste à choisir, écran verrouillé sur sa propre fiche.
  const [selfEmployeeId, setSelfEmployeeId] = useState<number | null>(null);
  const isSelfOnly = role === 'employee';
  // Statut courant (arrivée pointée ou non) de l'employé actuellement sélectionné
  // pour le pointage — sert à imposer l'ordre arrivée puis départ.
  const [currentStatus, setCurrentStatus] = useState<{ clockedIn: boolean; clockInTime: string | null } | null>(null);

  const [formData, setFormData] = useState({
    name: '',
    role: '',
    phone: '',
    avatarUrl: ''
  });
  const [isCapturingAvatar, setIsCapturingAvatar] = useState(false);
  const [avatarChecking, setAvatarChecking] = useState(false);
  const [avatarWarning, setAvatarWarning] = useState("");
  const avatarWebcamRef = useRef<any>(null);

  const webcamRef = useRef<any>(null);
  const [modelsReady, setModelsReady] = useState(false);
  const [modelsError, setModelsError] = useState(false);

  useEffect(() => {
    const loadData = async () => {
      if (user) {
        try {
          const rest = await getBusiness(user.id);
          if (rest) {
            setBusinessId(rest.id);
            if (rest.role) setRole(rest.role);
            const emps = await getEmployees(rest.id);
            setEmployees(emps);
            if (rest.role === 'employee') {
              // Verrouillé sur le pointage : pas d'accès à l'historique de toute
              // l'équipe (bloqué côté API de toute façon), pas de liste à choisir.
              setActiveTab('pointage');
              setPointageEmployeeId(rest.employeeId ? String(rest.employeeId) : '');
              setSelfEmployeeId(rest.employeeId ?? null);
              loadFaceModels().then(() => setModelsReady(true)).catch(() => setModelsError(true));
            } else {
              getTimeLogs(rest.id).then(setTimeLogs).catch(() => {});
            }
          }
        } catch (error) {
          console.error("Error loading employees", error);
        } finally {
          setLoading(false);
        }
      }
    };
    loadData();
  }, [user]);

  // Statut courant (arrivée en cours ou non) de l'employé sélectionné : détermine
  // si « Pointer mon départ » doit être bloqué (pas d'arrivée pointée aujourd'hui).
  useEffect(() => {
    if (!pointageEmployeeId) { setCurrentStatus(null); return; }
    getEmployeeStatus(parseInt(pointageEmployeeId)).then(setCurrentStatus).catch(() => setCurrentStatus(null));
  }, [pointageEmployeeId]);

  const handleDeleteEmployee = async (id: number) => {
    if (!confirm("Supprimer cet employé ? Son historique de pointage sera aussi supprimé.")) return;
    try {
      await deleteEmployee(id);
      setEmployees(employees.filter(e => e.id !== id));
    } catch (error) { console.error(error); }
  };

  const refreshTimeLogs = () => { if (businessId) getTimeLogs(businessId).then(setTimeLogs).catch(() => {}); };

  // Un pointage peut n'avoir que le départ (arrivée oubliée/non pointée) : on trie et
  // filtre alors sur l'heure de départ, faute de mieux.
  const logTime = (l: any) => new Date(l.clockInTime || l.clockOutTime || 0).getTime();

  // Employés classés du plus assidu (le plus de pointages) au moins assidu, avec leurs 2 derniers passages.
  const rankedEmployees = employees
    .map(emp => {
      const logs = timeLogs.filter(l => l.employeeId === emp.id).sort((a, b) => logTime(b) - logTime(a));
      return { ...emp, passageCount: logs.length, lastPassages: logs.slice(0, 2) };
    })
    .sort((a, b) => b.passageCount - a.passageCount);

  // --- Historique : bornes de la période sélectionnée ---
  const histRange = (() => {
    if (histPeriod === 'tout') return { from: 0, to: Number.MAX_SAFE_INTEGER, label: 'Tout l’historique' };
    const d = new Date(histDate + 'T00:00:00');
    let start = new Date(d), end = new Date(d);
    let label = '';
    if (histPeriod === 'jour') {
      end.setHours(23, 59, 59, 999);
      label = d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
    } else if (histPeriod === 'semaine') {
      start.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // lundi
      end = new Date(start); end.setDate(start.getDate() + 6); end.setHours(23, 59, 59, 999);
      label = `Semaine du ${start.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}`;
    } else {
      start = new Date(d.getFullYear(), d.getMonth(), 1);
      end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
      label = d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
    }
    return { from: start.getTime(), to: end.getTime(), label };
  })();

  const periodLogs = timeLogs.filter(l => {
    const t = logTime(l);
    return t >= histRange.from && t <= histRange.to;
  });
  const visibleLogs = periodLogs
    .filter(l => !historyFilter || String(l.employeeId) === historyFilter)
    .sort((a, b) => logTime(b) - logTime(a));
  // Bilan classé par employé sur la période (le plus assidu en premier).
  const bilan = employees
    .map(e => ({ id: e.id, name: e.name, count: periodLogs.filter(l => l.employeeId === e.id).length }))
    .sort((a, b) => b.count - a.count);
  const totalPointages = periodLogs.length;

  const [savingEmp, setSavingEmp] = useState(false);
  const handleAddEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!businessId || savingEmp) return;
    setSavingEmp(true);
    setFormError("");
    try {
      const newEmp = await createEmployee(businessId, formData);
      setEmployees([...employees, newEmp]);
      setShowAddModal(false);
      setFormData({ name: '', role: '', phone: '', avatarUrl: '' });
    } catch (error) {
      console.error("Error creating employee", error);
      setFormError((error as Error).message || "Échec de la création de l'employé.");
    } finally { setSavingEmp(false); }
  };

  const getLocation = (): Promise<{ locationLat?: string; locationLng?: string }> => {
    return new Promise((resolve) => {
      if (!navigator.geolocation) return resolve({});
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ locationLat: String(pos.coords.latitude), locationLng: String(pos.coords.longitude) }),
        () => resolve({}),
        { timeout: 5000 }
      );
    });
  };

  const capture = useCallback(async (mode: 'in' | 'out') => {
    setPointageError("");
    setPointageStatus('verifying');
    try {
      const selfieUrl = webcamRef.current?.getScreenshot();
      if (!selfieUrl) throw new Error("Impossible de capturer la photo. Autorisez la caméra.");

      let targetEmployeeId = pointageEmployeeId;

      if (targetEmployeeId) {
        // Quelqu'un est déjà identifié (auto pour le rôle 'employee', ou choisi
        // dans la liste) : simple vérification 1:1 contre sa photo d'inscription.
        const emp = employees.find(e => e.id === parseInt(targetEmployeeId));
        if (emp?.avatarUrl) {
          const r = await matchFaces(selfieUrl, emp.avatarUrl);
          if (r.error) { setPointageStatus('idle'); setPointageError(r.error); return; }
          if (!r.matched) {
            setPointageStatus('idle');
            setPointageError(`Visage non reconnu (écart ${r.distance.toFixed(2)}). Pointage refusé — ce n'est pas la personne inscrite.`);
            return;
          }
        }
      } else {
        // Personne présélectionné : reconnaissance automatique parmi tous les
        // employés inscrits — pratique sur un terminal partagé où plusieurs
        // personnes se relaient, sans avoir à chercher son nom dans la liste.
        const candidates = employees.filter(e => e.avatarUrl).map(e => ({ id: e.id, refUrl: e.avatarUrl as string }));
        if (candidates.length === 0) {
          setPointageStatus('idle');
          setPointageError("Aucun employé n'a de photo d'inscription pour la reconnaissance automatique. Sélectionnez votre nom dans la liste.");
          return;
        }
        const result = await identifyFace(selfieUrl, candidates);
        if (!result.id) {
          setPointageStatus('idle');
          setPointageError(result.error || "Visage non reconnu.");
          return;
        }
        targetEmployeeId = String(result.id);
        setPointageEmployeeId(targetEmployeeId);
      }

      // Vérifie l'état réel (pas l'état affiché, potentiellement périmé quand on
      // vient tout juste d'identifier la personne par reconnaissance automatique).
      const status = await getEmployeeStatus(parseInt(targetEmployeeId));
      if (mode === 'out' && !status.clockedIn) {
        setPointageStatus('idle');
        setPointageError("Pointez d'abord votre arrivée avant de pointer votre départ.");
        return;
      }
      if (mode === 'in' && status.clockedIn) {
        setPointageStatus('idle');
        setPointageError("Arrivée déjà pointée aujourd'hui.");
        return;
      }

      if (mode === 'in') {
        const location = await getLocation();
        await clockIn(parseInt(targetEmployeeId), { selfieUrl, ...location, livenessConfirmed: "true" });
      } else {
        await clockOut(parseInt(targetEmployeeId));
      }
      setPointageStatus('success');
      if (!isSelfOnly) refreshTimeLogs();
      getEmployeeStatus(parseInt(targetEmployeeId)).then(setCurrentStatus).catch(() => {});
      setTimeout(() => setPointageStatus('idle'), 3000);
    } catch (error) {
      setPointageStatus('idle');
      setPointageError((error as Error).message || "Échec du pointage.");
    }
  }, [webcamRef, pointageEmployeeId, employees, isSelfOnly]);

  if (loading) return <Layout><div className="flex justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" /></div></Layout>;

  return (
    <Layout>
      <div className="mb-8 flex flex-col sm:flex-row justify-between sm:items-end gap-3">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">{isSelfOnly ? "Pointage" : "Employés"}</h1>
          <p className="text-sm text-gray-500 mt-1">{isSelfOnly ? "Pointez votre arrivée et votre départ" : "Gérez votre équipe et les pointages"}</p>
        </div>
        {!isSelfOnly && (
          <div className="flex bg-gray-200 p-1 rounded-lg">
            <button
              onClick={() => {
                setActiveTab('pointage');
                setModelsError(false);
                loadFaceModels().then(() => setModelsReady(true)).catch(() => setModelsError(true));
              }}
              className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${activeTab === 'pointage' ? 'bg-white shadow text-indigo-600' : 'text-gray-600 hover:text-gray-900'}`}
            >
              Pointage
            </button>
            <button
              onClick={() => setActiveTab('list')}
              className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${activeTab === 'list' ? 'bg-white shadow text-indigo-600' : 'text-gray-600 hover:text-gray-900'}`}
            >
              Liste
            </button>
            <button
              onClick={() => { setActiveTab('historique'); refreshTimeLogs(); }}
              className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${activeTab === 'historique' ? 'bg-white shadow text-indigo-600' : 'text-gray-600 hover:text-gray-900'}`}
            >
              Historique
            </button>
          </div>
        )}
      </div>

      {activeTab === 'historique' && (
        <div className="space-y-6">
          {/* Filtres période + date + employé */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-3 flex flex-col sm:flex-row sm:items-center gap-3 flex-wrap">
            <div className="flex bg-gray-100 rounded-lg p-1">
              {([['jour', 'Jour'], ['semaine', 'Semaine'], ['mois', 'Mois'], ['tout', 'Tout']] as const).map(([val, lbl]) => (
                <button key={val} onClick={() => setHistPeriod(val)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${histPeriod === val ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:text-gray-900'}`}>
                  {lbl}
                </button>
              ))}
            </div>
            {histPeriod !== 'tout' && (
              <input type="date" value={histDate} onChange={e => setHistDate(e.target.value)} className="border-gray-200 rounded-lg text-sm py-1.5" />
            )}
            <select value={historyFilter} onChange={e => setHistoryFilter(e.target.value)} className="text-sm border-gray-200 rounded-lg py-1.5 sm:ml-auto">
              <option value="">Tous les employés</option>
              {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>

          {/* Bilan par employé (période) */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
              <span className="text-sm font-medium text-gray-900 flex items-center"><History className="h-4 w-4 text-indigo-500 mr-2" />Bilan des pointages — {histRange.label}</span>
              <span className="text-xs text-gray-500">{totalPointages} pointage{totalPointages > 1 ? 's' : ''}</span>
            </div>
            {bilan.every(b => b.count === 0) ? (
              <div className="p-6 text-center text-gray-500 text-sm">Aucun pointage sur cette période.</div>
            ) : (
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100 text-xs font-semibold text-gray-500 uppercase">
                    <th className="px-6 py-3">#</th>
                    <th className="px-6 py-3">Employé</th>
                    <th className="px-6 py-3 text-right">Pointages</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {bilan.map((b, i) => (
                    <tr key={b.id} className="hover:bg-gray-50">
                      <td className="px-6 py-3 text-sm text-gray-400">{b.count > 0 ? i + 1 : '—'}</td>
                      <td className="px-6 py-3 text-sm font-medium text-gray-900">{i === 0 && b.count > 0 && <span className="mr-1.5">🏆</span>}{b.name}</td>
                      <td className="px-6 py-3 text-right"><span className="inline-block min-w-[2rem] text-sm font-bold text-indigo-600">{b.count}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Détail (lecture seule) */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 bg-gray-50">
              <span className="text-sm font-medium text-gray-900">Détail des pointages (lecture seule)</span>
            </div>
            {visibleLogs.length === 0 ? (
              <div className="p-8 text-center text-gray-500">Aucun pointage sur cette période.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100 text-xs font-semibold text-gray-500 uppercase">
                      <th className="px-6 py-3">Employé</th>
                      <th className="px-6 py-3">Arrivée</th>
                      <th className="px-6 py-3">Départ</th>
                      <th className="px-6 py-3">Photo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {visibleLogs.map((log) => (
                      <tr key={log.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4 text-sm font-medium text-gray-900">{log.employeeName}</td>
                        <td className="px-6 py-4 text-sm text-gray-600">
                          <span className="flex items-center"><LogIn className="h-3.5 w-3.5 mr-1 text-green-500" />{log.clockInTime ? new Date(log.clockInTime).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}</span>
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-600">
                          {log.clockOutTime ? <span className="flex items-center"><LogOut className="h-3.5 w-3.5 mr-1 text-gray-400" />{new Date(log.clockOutTime).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span> : <span className="text-green-600 text-xs font-medium">En cours</span>}
                        </td>
                        <td className="px-6 py-4">
                          {log.selfieUrl ? <img src={log.selfieUrl} alt="pointage" className="h-9 w-9 rounded-lg object-cover border border-gray-200" /> : <span className="text-gray-300 text-xs">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'pointage' && (
        <div className="max-w-md mx-auto">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="p-6 text-center border-b border-gray-100">
              <h2 className="text-xl font-bold text-gray-900">Terminal de Pointage</h2>
              <p className="text-sm text-gray-500 mt-1">Reconnaissance faciale (comparée à la photo d'inscription) + géolocalisation horodatée</p>
            </div>

            <div className="p-6 bg-gray-50 flex flex-col items-center">
              <div className="w-full mb-4 bg-indigo-50 border border-indigo-100 text-indigo-800 rounded-lg px-3 py-2 text-xs">
                Pointez d'abord votre <strong>arrivée</strong> en arrivant, puis votre <strong>départ</strong> en repartant — dans cet ordre.
              </div>

              {isSelfOnly ? (
                <div className="w-full mb-4">
                  <p className="text-sm font-medium text-gray-900">
                    Bonjour, {employees.find(e => e.id === selfEmployeeId)?.name || "—"} 👋
                  </p>
                </div>
              ) : (
                <div className="w-full mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Votre nom (optionnel)</label>
                  <select
                    value={pointageEmployeeId}
                    onChange={(e) => { setPointageEmployeeId(e.target.value); setPointageError(""); }}
                    className="w-full border-gray-300 rounded-lg shadow-sm"
                  >
                    <option value="">Reconnaissance automatique (prenez directement la photo)</option>
                    {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                  </select>
                  <p className="text-[11px] text-gray-400 mt-1">Pas besoin de choisir votre nom : prenez la photo directement, le logiciel vous reconnaît tout seul. La liste sert seulement en cas d'échec de la reconnaissance.</p>
                </div>
              )}

              {pointageEmployeeId && (
                <div className={`w-full mb-4 px-4 py-2 rounded text-sm ${currentStatus?.clockedIn ? "bg-green-50 border border-green-200 text-green-700" : "bg-amber-50 border border-amber-200 text-amber-800"}`}>
                  {currentStatus?.clockedIn
                    ? `En service depuis ${currentStatus.clockInTime ? new Date(currentStatus.clockInTime).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : "aujourd'hui"}`
                    : "Pas encore arrivé(e) aujourd'hui — pointez votre arrivée."}
                </div>
              )}

              {/* État des modèles de reconnaissance faciale */}
              {modelsError ? (
                <div className="w-full mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded text-sm">
                  Reconnaissance faciale indisponible (modèles non chargés). Vérifiez la connexion et rechargez la page.
                </div>
              ) : !modelsReady ? (
                <div className="w-full mb-4 bg-indigo-50 border border-indigo-100 text-indigo-700 px-4 py-2 rounded text-sm flex items-center">
                  <span className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-indigo-500 mr-2" />
                  Chargement de la reconnaissance faciale...
                </div>
              ) : null}

              {/* Avertit si l'employé choisi n'a pas de photo de référence */}
              {pointageEmployeeId && !employees.find(e => e.id === parseInt(pointageEmployeeId))?.avatarUrl && (
                <div className="w-full mb-4 bg-amber-50 border border-amber-200 text-amber-800 px-4 py-2 rounded text-sm">
                  Aucune photo d'inscription pour cet employé : le visage ne pourra pas être vérifié. Ajoutez sa photo de profil dans l'onglet « Liste ».
                </div>
              )}

              {pointageError && (
                <div className="w-full mb-4 bg-red-50 border border-red-200 text-red-600 px-4 py-2 rounded text-sm" role="alert">
                  {pointageError}
                </div>
              )}

              {pointageStatus === 'idle' || pointageStatus === 'capturing' || pointageStatus === 'verifying' ? (
                <div className="relative rounded-xl overflow-hidden shadow-inner border-2 border-indigo-100 w-full max-w-[300px] aspect-[3/4] bg-black">
                  {/* @ts-ignore */}
                  <Webcam
                    audio={false}
                    ref={webcamRef}
                    screenshotFormat="image/jpeg"
                    screenshotQuality={0.92}
                    className="w-full h-full object-cover"
                    // Miroir d'AFFICHAGE uniquement (style CSS, pas la prop `mirrored` de
                    // react-webcam) : sans ça, une caméra frontale montre l'image "vraie"
                    // (comme si quelqu'un vous faisait face), ce qui donne l'impression que
                    // la droite et la gauche sont inversées quand on se positionne. La
                    // prop `mirrored` inverserait aussi la photo CAPTURÉE (getScreenshot),
                    // ce qui la rendrait incohérente avec les photos de référence déjà
                    // enregistrées (non inversées) — on ne veut QUE l'aperçu inversé.
                    style={{ transform: "scaleX(-1)" }}
                    videoConstraints={{ facingMode: "user", width: { ideal: 720 }, height: { ideal: 960 } }}
                  />

                  {/* Overlay scanning effect */}
                  {pointageStatus === 'verifying' && (
                    <div className="absolute inset-0 bg-indigo-500/80 z-10 flex items-center justify-center backdrop-blur-sm">
                      <div className="text-white font-bold flex flex-col items-center p-4 text-center">
                        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-white mb-4"></div>
                        <p className="text-sm">Reconnaissance faciale...</p>
                        <p className="text-xs font-normal opacity-80 mt-1">Comparaison avec la photo d'inscription</p>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="w-full max-w-[300px] aspect-[3/4] bg-green-50 rounded-xl border-2 border-green-200 flex flex-col items-center justify-center">
                  <CheckCircle className="h-16 w-16 text-green-500 mb-4" />
                  <h3 className="text-lg font-bold text-green-700">Pointage réussi !</h3>
                  {!isSelfOnly && pointageEmployeeId && (
                    <p className="text-green-700 text-sm font-medium mt-1">{employees.find(e => e.id === parseInt(pointageEmployeeId))?.name}</p>
                  )}
                  <p className="text-green-600 text-sm mt-1">{new Date().toLocaleTimeString()}</p>
                </div>
              )}

              <div className="mt-8 w-full space-y-3">
                <button
                  onClick={() => capture('in')}
                  disabled={pointageStatus !== 'idle' || (!!pointageEmployeeId && !!currentStatus?.clockedIn)}
                  title={pointageEmployeeId && currentStatus?.clockedIn ? "Arrivée déjà pointée aujourd'hui" : undefined}
                  className="w-full flex items-center justify-center px-4 py-3 bg-indigo-600 text-white font-medium rounded-xl hover:bg-indigo-700 transition-colors disabled:opacity-50"
                >
                  <Clock className="w-5 h-5 mr-2" />
                  Pointer mon arrivée
                </button>
                <button
                  onClick={() => capture('out')}
                  disabled={pointageStatus !== 'idle' || (!!pointageEmployeeId && !currentStatus?.clockedIn)}
                  title={pointageEmployeeId && !currentStatus?.clockedIn ? "Pointez d'abord votre arrivée" : undefined}
                  className="w-full flex items-center justify-center px-4 py-3 bg-white border border-gray-300 text-gray-700 font-medium rounded-xl hover:bg-gray-50 transition-colors disabled:opacity-50"
                >
                  <Clock className="w-5 h-5 mr-2" />
                  Pointer mon départ
                </button>
              </div>
            </div>
            
            <div className="p-4 bg-white text-xs text-center text-gray-500 border-t border-gray-100">
              Assurez-vous d'être sur votre lieu de travail. La position GPS sera enregistrée.
            </div>
          </div>
        </div>
      )}

      {activeTab === 'list' && (
        <>
          <div className="flex justify-end mb-4">
            <button
              onClick={() => { setFormError(""); setShowAddModal(true); }}
              className="flex items-center px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors shadow-sm text-sm font-medium"
            >
              <Plus className="h-4 w-4 mr-2" />
              Ajouter un employé
            </button>
          </div>

          {loading ? (
            <div className="flex justify-center p-8"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div></div>
          ) : employees.length === 0 ? (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-8 text-center">
              <Briefcase className="h-12 w-12 text-gray-300 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900">Aucun employé</h3>
              <p className="text-gray-500 mt-1">Ajoutez le premier collaborateur pour commencer.</p>
              <button
                onClick={() => { setFormError(""); setShowAddModal(true); }}
                className="mt-4 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
              >
                Ajouter un employé
              </button>
            </div>
          ) : (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      <th className="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Nom complet</th>
                      <th className="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Rôle</th>
                      <th className="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Téléphone</th>
                      <th className="px-6 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Assiduité</th>
                      <th className="px-6 py-4"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {rankedEmployees.map((emp, i) => (
                      <tr key={emp.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-6 py-4 flex items-center">
                          {emp.avatarUrl ? (
                            <img src={emp.avatarUrl} alt={emp.name} className="h-8 w-8 rounded-full object-cover mr-3 border border-gray-200" />
                          ) : (
                            <div className="h-8 w-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 font-bold mr-3">
                              {emp.name ? emp.name.charAt(0).toUpperCase() : '?'}
                            </div>
                          )}
                          <div>
                            <p className="text-sm font-medium text-gray-900 flex items-center">
                              {i === 0 && emp.passageCount > 0 && <span title="Le plus assidu" className="mr-1.5">🏆</span>}
                              {emp.name}
                            </p>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span className="px-2.5 py-1 text-xs font-medium rounded-full bg-gray-100 text-gray-700">
                            {emp.role}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-500">
                          {emp.phone || 'Non renseigné'}
                        </td>
                        <td className="px-6 py-4 text-sm">
                          <p className="font-semibold text-gray-900">{emp.passageCount} pointage{emp.passageCount > 1 ? "s" : ""}</p>
                          {emp.lastPassages.length > 0 && (
                            <p className="text-xs text-gray-400">
                              Derniers : {emp.lastPassages.map((l: any) => new Date(logTime(l)).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })).join(", ")}
                            </p>
                          )}
                        </td>
                        <td className="px-6 py-4 text-right">
                          {role === 'admin' && (
                            <button onClick={() => handleDeleteEmployee(emp.id)} title="Supprimer" className="text-gray-300 hover:text-red-500">
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* Add Employee Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-gray-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
              <h3 className="text-lg font-bold text-gray-900">Nouvel Employé</h3>
              <button 
                onClick={() => setShowAddModal(false)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            
            <form onSubmit={handleAddEmployee} className="p-6">
              <div className="space-y-4">
                {formError && (
                  <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-2 rounded text-sm" role="alert">
                    {formError}
                  </div>
                )}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Nom complet</label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <User className="h-5 w-5 text-gray-400" />
                    </div>
                    <input
                      type="text"
                      required
                      value={formData.name}
                      onChange={(e) => setFormData({...formData, name: e.target.value})}
                      className="block w-full pl-10 pr-3 py-2.5 border border-gray-200 rounded-xl focus:ring-indigo-500 focus:border-indigo-500 text-sm"
                      placeholder="Prénom et Nom"
                    />
                  </div>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Rôle</label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <Tag className="h-5 w-5 text-gray-400" />
                    </div>
                    <input
                      type="text"
                      required
                      value={formData.role}
                      onChange={(e) => setFormData({...formData, role: e.target.value})}
                      className="block w-full pl-10 pr-3 py-2.5 border border-gray-200 rounded-xl focus:ring-indigo-500 focus:border-indigo-500 text-sm"
                      placeholder="Ex: Vendeur, Technicien, Réceptionniste..."
                    />
                  </div>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Photo de profil</label>
                  {formData.avatarUrl ? (
                    <div className="flex flex-col items-center">
                      <img src={formData.avatarUrl} alt="Avatar" className="w-24 h-24 rounded-full object-cover mb-2 border-2 border-indigo-100" />
                      <button type="button" onClick={() => setFormData({...formData, avatarUrl: ''})} className="text-xs text-red-500 hover:underline">Reprendre</button>
                    </div>
                  ) : isCapturingAvatar ? (
                    <div className="flex flex-col items-center">
                      <div className="w-full max-w-[200px] rounded-lg overflow-hidden mb-2">
                        {/* @ts-ignore */}
                        <Webcam
                          audio={false}
                          ref={avatarWebcamRef}
                          screenshotFormat="image/jpeg"
                          screenshotQuality={0.92}
                          className="w-full h-auto"
                          style={{ transform: "scaleX(-1)" }}
                          videoConstraints={{ facingMode: "user", width: { ideal: 720 }, height: { ideal: 960 } }}
                        />
                      </div>
                      <div className="flex space-x-2">
                        <button type="button" disabled={avatarChecking} onClick={async () => {
                          const src = avatarWebcamRef.current?.getScreenshot();
                          if (!src) return;
                          setAvatarChecking(true);
                          setAvatarWarning("");
                          // On vérifie qu'un visage est bien exploitable AVANT d'enregistrer
                          // la photo de référence, sinon le pointage échouerait plus tard.
                          const ok = await hasDetectableFace(src);
                          setAvatarChecking(false);
                          if (!ok) {
                            setAvatarWarning("Aucun visage détecté sur cette photo. Reprenez-la bien de face, dans un endroit éclairé.");
                            return;
                          }
                          setFormData({ ...formData, avatarUrl: src });
                          setIsCapturingAvatar(false);
                        }} className="px-3 py-1 bg-indigo-600 text-white rounded text-sm disabled:opacity-50">
                          {avatarChecking ? "Analyse..." : "Capturer"}
                        </button>
                        <button type="button" onClick={() => { setIsCapturingAvatar(false); setAvatarWarning(""); }} className="px-3 py-1 bg-gray-200 text-gray-700 rounded text-sm">Annuler</button>
                      </div>
                      {avatarWarning && <p className="text-xs text-red-600 mt-2 text-center max-w-[220px]">{avatarWarning}</p>}
                    </div>
                  ) : (
                    <button type="button" onClick={() => setIsCapturingAvatar(true)} className="w-full py-3 border-2 border-dashed border-gray-300 rounded-xl text-gray-500 hover:bg-gray-50 transition-colors flex flex-col items-center justify-center">
                      <Camera className="h-6 w-6 mb-1 text-gray-400" />
                      <span className="text-sm font-medium">Prendre une photo</span>
                    </button>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Téléphone</label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <Key className="h-5 w-5 text-gray-400" />
                    </div>
                    <input
                      type="tel"
                      required
                      value={formData.phone}
                      onChange={(e) => setFormData({...formData, phone: e.target.value})}
                      className="block w-full pl-10 pr-3 py-2.5 border border-gray-200 rounded-xl focus:ring-indigo-500 focus:border-indigo-500 text-sm"
                      placeholder="06 12 34 56 78"
                    />
                  </div>
                  <p className="text-xs text-gray-500 mt-1">Numéro pour le contacter en cas de besoin.</p>
                </div>
              </div>
              
              <div className="mt-6">
                <button
                  type="submit"
                  disabled={savingEmp}
                  className="w-full flex justify-center py-2.5 px-4 border border-transparent rounded-xl shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
                >
                  {savingEmp ? "..." : "Créer l'employé"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </Layout>
  );
}
