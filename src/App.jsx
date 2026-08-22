import "./App.css";
import logo from "./assets/logo.webp";
import { useState, useEffect, useRef } from "react";
import { QRCodeCanvas } from "qrcode.react";
import { Html5Qrcode } from "html5-qrcode";
import capa from "./assets/capa.webp";
import jsPDF from "jspdf";
import { supabase, supabaseConfigurado } from "./lib/supabaseClient";
import { entrarComEmailSenha, obterPerfilSupabase, sairDoSupabase } from "./services/supabaseAuth";
import {
  buscarUsuarioSistemaOnline,
  buscarUsuarioSistemaOnlinePorAluno,
  listarAlunosOnline,
  listarPagamentosOnline,
  listarPresencasOnline,
  migrarAlunosOnline,
  obterAlunoOnline,
  obterFotoAlunoOnline,
  registrarPresencaOnline,
  removerAlunoOnline,
  removerUsuarioSistemaOnlinePorAluno,
  enviarArquivoOnline,
  salvarAlunoOnline,
  salvarPagamentoOnline,
  salvarUsuarioSistemaOnline,
} from "./services/supabaseStore";

const APP_NAME = "Ariramba Jiu-Jitsu School";
const DIA_COBRANCA_PADRAO = 27;
const TAMANHO_FOTO_AJUSTADA = 640;
const TAMANHO_PREVIEW_FOTO = 300;
const QUALIDADE_FOTO_AJUSTADA = 0.84;

const STORAGE_KEYS = {
  alunos: "alunos_ariramba_jiu_jitsu_school",
  presencas: "presencas_ariramba_jiu_jitsu_school",
  avisos: "avisos_ariramba_jiu_jitsu_school",
  usuarios: "usuarios_ariramba_jiu_jitsu_school",
  usuarioLogado: "usuario_logado_ariramba_jiu_jitsu_school",
};

function recuperarDadosSalvos(chaves, valorPadrao) {
  for (const chave of chaves) {
    const dados = localStorage.getItem(chave);

    if (dados) {
      try {
        return JSON.parse(dados);
      } catch (error) {
        console.warn(`Dados inválidos em ${chave}. Tentando próxima chave.`, error);
      }
    }
  }

  return valorPadrao;
}

function salvarDados(chave, valor) {
  try {
    localStorage.setItem(chave, JSON.stringify(valor));
    return true;
  } catch (error) {
    console.error(`Não foi possível salvar ${chave}.`, error);
    return false;
  }
}

function normalizarAluno(aluno) {
  const fotoAluno = aluno.foto || aluno.fotoUrl || aluno.foto_url || "";

  return {
    ...aluno,
    turma: aluno.turma || "Adultos",
    foto: fotoAluno,
    fotoUrl: aluno.fotoUrl || aluno.foto_url || fotoAluno,
    presencas: Array.isArray(aluno.presencas) ? aluno.presencas : [],
    historicoPagamentos: Array.isArray(aluno.historicoPagamentos)
      ? aluno.historicoPagamentos
      : [],
    statusPagamento: aluno.statusPagamento || "Pendente",
    mensalidade: Number(aluno.mensalidade || 0),
    vencimento: Number(aluno.vencimento || 0),
  };
}

function obterFotoAluno(aluno) {
  return aluno?.foto || aluno?.fotoUrl || aluno?.foto_url || "";
}

function aplicarPresencasNosAlunos(alunos, presencas) {
  return alunos.map((aluno) => ({
    ...aluno,
    presencas: presencas
      .filter((presenca) => String(presenca.alunoId) === String(aluno.id))
      .map((presenca) => ({
        data: presenca.data,
        hora: presenca.hora,
      })),
  }));
}

function completarPresencasComAlunos(presencas, alunos) {
  const alunosPorId = new Map(
    alunos.map((aluno) => [String(aluno.id), aluno])
  );

  return presencas.map((presenca) => {
    const aluno = alunosPorId.get(String(presenca.alunoId));

    return {
      ...presenca,
      nome: presenca.nome || aluno?.nome || "",
      foto: presenca.foto || aluno?.foto || aluno?.fotoUrl || "",
    };
  });
}

function dataISOParaBrasil(data) {
  if (!data) return "";
  if (data.includes("/")) return data;

  const partes = data.split("-");
  if (partes.length !== 3) return data;

  return partes.reverse().join("/");
}

function dataPagamentoParaTempo(pagamento) {
  return new Date(pagamento.criado_em || pagamento.data_pagamento || 0).getTime();
}

function obterUltimoPagamentoDoAluno(pagamentos, idAluno) {
  return pagamentos
    .filter((pagamento) => String(pagamento.aluno_id) === String(idAluno))
    .sort((a, b) => dataPagamentoParaTempo(b) - dataPagamentoParaTempo(a))[0];
}

function comprovanteEhImagem(comprovante) {
  return typeof comprovante === "string" && comprovante.startsWith("data:image/");
}

function abrirArquivoComprovante(comprovante) {
  if (!comprovante) return;

  if (!comprovante.startsWith("data:")) {
    window.open(comprovante, "_blank", "noopener,noreferrer");
    return;
  }

  const [cabecalho, base64] = comprovante.split(",");
  const tipoArquivo =
    cabecalho.match(/^data:(.*?);base64$/)?.[1] || "application/octet-stream";

  try {
    const binario = atob(base64);
    const bytes = new Uint8Array(binario.length);

    for (let i = 0; i < binario.length; i += 1) {
      bytes[i] = binario.charCodeAt(i);
    }

    const blob = new Blob([bytes], { type: tipoArquivo });
    const url = URL.createObjectURL(blob);
    const janela = window.open(url, "_blank", "noopener,noreferrer");

    if (!janela) {
      const link = document.createElement("a");
      link.href = url;
      link.download = tipoArquivo.includes("pdf")
        ? "comprovante.pdf"
        : "comprovante";
      link.click();
    }

    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (error) {
    console.error("Erro ao abrir comprovante.", error);
    alert("Não foi possível abrir o comprovante. Tente baixar ou reenviar o arquivo.");
  }
}

function extrairIdAlunoDoQRCode(valor) {
  const textoOriginal = String(valor || "").trim();

  if (!textoOriginal) return "";

  try {
    const dados = JSON.parse(textoOriginal);
    const idEncontrado = dados.alunoId || dados.aluno_id || dados.id;

    if (idEncontrado) return String(idEncontrado).trim();
  } catch {
    // QR antigo em texto simples.
  }

  const texto = (() => {
    try {
      return decodeURIComponent(textoOriginal);
    } catch {
      return textoOriginal;
    }
  })();

  const alunoComPrefixo = texto.match(/aluno-([a-z0-9_-]+)/i);
  if (alunoComPrefixo?.[1]) return alunoComPrefixo[1].trim();

  const arirambaComPrefixo = texto.match(/AR:(.+)$/i);
  if (arirambaComPrefixo?.[1]) return arirambaComPrefixo[1].trim();

  try {
    const url = new URL(texto);
    const idPorParametro =
      url.searchParams.get("aluno") ||
      url.searchParams.get("alunoId") ||
      url.searchParams.get("id");

    if (idPorParametro) return idPorParametro.trim();

    const idNoCaminho = url.pathname.match(/\/aluno\/([^/]+)/i);
    if (idNoCaminho?.[1]) return idNoCaminho[1].trim();
  } catch {
    // Nao era URL.
  }

  const textoSemPrefixo = texto
    .replace(/^id\s*[:=]\s*/i, "")
    .replace(/^aluno\s*[:=]\s*/i, "")
    .trim();

  return textoSemPrefixo;
}

function normalizarTextoBusca(valor) {
  return String(valor || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function carregarImagem(src) {
  return new Promise((resolve, reject) => {
    const imagem = new Image();

    const timeout = setTimeout(() => {
      reject(new Error("Imagem demorou demais para carregar."));
    }, 8000);

    imagem.onload = () => {
      clearTimeout(timeout);
      resolve(imagem);
    };
    imagem.onerror = (error) => {
      clearTimeout(timeout);
      reject(error);
    };
    imagem.src = src;
  });
}

function normalizarNomeArquivo(valor) {
  return String(valor || "aluno")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "aluno";
}

async function prepararFotoCarteirinha(src) {
  const imagem = await carregarImagem(src);
  const tamanho = 320;
  const fotoDeitada = imagem.width > imagem.height;
  const larguraOrigem = fotoDeitada ? imagem.height : imagem.width;
  const alturaOrigem = fotoDeitada ? imagem.width : imagem.height;
  const canvas = document.createElement("canvas");
  const contexto = canvas.getContext("2d");
  canvas.width = tamanho;
  canvas.height = tamanho;

  const escala = Math.max(tamanho / larguraOrigem, tamanho / alturaOrigem);
  const largura = larguraOrigem * escala;
  const altura = alturaOrigem * escala;
  const x = (tamanho - largura) / 2;
  const y = (tamanho - altura) / 2;

  contexto.fillStyle = "#111827";
  contexto.fillRect(0, 0, tamanho, tamanho);

  if (fotoDeitada) {
    contexto.save();
    contexto.translate(tamanho / 2, tamanho / 2);
    contexto.rotate(Math.PI / 2);
    contexto.drawImage(imagem, -altura / 2, -largura / 2, altura, largura);
    contexto.restore();
  } else {
    contexto.drawImage(imagem, x, y, largura, altura);
  }

  return canvas.toDataURL("image/jpeg", 0.9);
}

function lerImagemCompactada(arquivo) {
  return new Promise((resolve, reject) => {
    if (!arquivo) {
      resolve("");
      return;
    }

    if (!arquivo.type.startsWith("image/")) {
      reject(new Error("Escolha uma imagem para a foto do aluno."));
      return;
    }

    const leitor = new FileReader();
    leitor.onerror = reject;
    leitor.onload = () => {
      const imagem = new Image();
      imagem.onerror = reject;
      imagem.onload = () => {
        const limite = 640;
        const escala = Math.min(1, limite / Math.max(imagem.width, imagem.height));
        const largura = Math.max(1, Math.round(imagem.width * escala));
        const altura = Math.max(1, Math.round(imagem.height * escala));
        const canvas = document.createElement("canvas");
        const contexto = canvas.getContext("2d");

        canvas.width = largura;
        canvas.height = altura;
        contexto.drawImage(imagem, 0, 0, largura, altura);
        resolve(canvas.toDataURL("image/jpeg", 0.72));
      };
      imagem.src = leitor.result;
    };
    leitor.readAsDataURL(arquivo);
  });
}

function converterDataUrlParaBlob(dataUrl) {
  const [cabecalho, conteudoBase64] = String(dataUrl || "").split(",");

  if (!cabecalho?.startsWith("data:image/") || !conteudoBase64) {
    throw new Error("Foto do professor invalida.");
  }

  const tipo = cabecalho.match(/data:(.*?);base64/)?.[1] || "image/jpeg";
  const binario = atob(conteudoBase64);
  const bytes = new Uint8Array(binario.length);

  for (let indice = 0; indice < binario.length; indice += 1) {
    bytes[indice] = binario.charCodeAt(indice);
  }

  return new Blob([bytes], { type: tipo });
}

function fotoProfessorPrecisaUpload(fotoProfessor) {
  return String(fotoProfessor || "").startsWith("data:image/");
}

function aplicarPagamentosNosAlunos(alunos, pagamentos) {
  return alunos.map((aluno) => {
    const pagamentosDoAluno = pagamentos.filter(
      (pagamento) => String(pagamento.aluno_id) === String(aluno.id)
    );
    const pagos = pagamentosDoAluno
      .filter((pagamento) => pagamento.status === "Pago")
      .sort((a, b) => dataPagamentoParaTempo(b) - dataPagamentoParaTempo(a));
    const ultimoPagamento = obterUltimoPagamentoDoAluno(pagamentos, aluno.id);
    const aguardando =
      ultimoPagamento?.status === "Aguardando" ? ultimoPagamento : null;
    const ultimoComprovante = pagamentosDoAluno
      .filter((pagamento) => pagamento.comprovante_url)
      .sort((a, b) => dataPagamentoParaTempo(b) - dataPagamentoParaTempo(a))[0];
    const ultimoPago = pagos[0];

    return {
      ...aluno,
      statusPagamento: ultimoPagamento?.status || aluno.statusPagamento,
      comprovantePagamento:
        aguardando?.comprovante_url ||
        ultimoComprovante?.comprovante_url ||
        aluno.comprovantePagamento,
      dataEnvioComprovante:
        dataISOParaBrasil(aguardando?.data_pagamento) ||
        dataISOParaBrasil(ultimoComprovante?.data_pagamento) ||
        aluno.dataEnvioComprovante,
      ultimoPagamento: dataISOParaBrasil(ultimoPago?.data_pagamento) || aluno.ultimoPagamento,
      historicoPagamentos: pagos.map((pagamento) => ({
        data: dataISOParaBrasil(pagamento.data_pagamento),
        valor: Number(pagamento.valor || 0),
      })),
    };
  });
}

function mesclarAlunosPreservandoLocais(alunosAtuais, alunosRecebidos) {
  const alunosPorId = new Map(
    alunosAtuais.map((aluno) => [String(aluno.id), normalizarAluno(aluno)])
  );

  alunosRecebidos.forEach((alunoRecebido) => {
    const alunoNormalizado = normalizarAluno(alunoRecebido);
    const alunoAtual = alunosPorId.get(String(alunoNormalizado.id));

    alunosPorId.set(String(alunoNormalizado.id), {
      ...alunoAtual,
      ...alunoNormalizado,
      foto: alunoNormalizado.foto || alunoAtual?.foto || alunoNormalizado.fotoUrl || "",
      fotoUrl: alunoNormalizado.fotoUrl || alunoAtual?.fotoUrl || "",
      comprovantePagamento:
        alunoNormalizado.comprovantePagamento ||
        alunoAtual?.comprovantePagamento ||
        "",
      dataEnvioComprovante:
        alunoNormalizado.dataEnvioComprovante ||
        alunoAtual?.dataEnvioComprovante ||
        "",
    });
  });

  return Array.from(alunosPorId.values()).sort((a, b) =>
    String(a.nome || "").localeCompare(String(b.nome || ""), "pt-BR", {
      sensitivity: "base",
    })
  );
}

function criarUsuarioAluno(nome, usuarios) {
  const base =
    nome
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ".")
      .replace(/^\.+|\.+$/g, "") || "aluno";
  let usuario = base;
  let contador = 1;

  while (
    usuarios.some(
      (usuarioCadastrado) =>
        usuarioCadastrado.usuario.toLowerCase() === usuario.toLowerCase()
    )
  ) {
    contador += 1;
    usuario = `${base}${contador}`;
  }

  return usuario;
}

function criarIdAluno() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  return `local-${Date.now()}`;
}

function idAlunoOnlineValido(id) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(id || "")
  );
}

function limitarTempo(promise, tempoMs, mensagem) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(mensagem)), tempoMs)
    ),
  ]);
}

async function desfazerAlunoOnlineCriado(idAluno) {
  if (!idAlunoOnlineValido(idAluno)) return;

  try {
    await removerAlunoOnline(idAluno);
  } catch (error) {
    console.error("Erro ao desfazer aluno online criado sem acesso.", error);
  }
}

function ModalMensagem({ modal, onFechar }) {
  if (!modal) return null;

  const tipo = modal.tipo || "informacao";
  const titulo = modal.titulo || "Mensagem";
  const mensagem = modal.mensagem || "";
  const botao = modal.botao || "OK";

  return (
    <div className="modalMensagemFundo" role="presentation">
      <div
        className={`modalMensagem modalMensagem-${tipo}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modalMensagemTitulo"
      >
        <span className="modalMensagemIndicador" aria-hidden="true"></span>

        <h2 id="modalMensagemTitulo">{titulo}</h2>

        <p>{mensagem}</p>

        <button type="button" onClick={onFechar}>
          {botao}
        </button>
      </div>
    </div>
  );
}

function limitarNumero(valor, minimo, maximo) {
  return Math.min(Math.max(valor, minimo), maximo);
}

function calcularLimitesAjusteFoto(larguraImagem, alturaImagem, tamanhoPreview, zoom) {
  if (!larguraImagem || !alturaImagem || !tamanhoPreview) {
    return { limiteX: 0, limiteY: 0 };
  }

  const escalaBase = Math.max(
    tamanhoPreview / larguraImagem,
    tamanhoPreview / alturaImagem
  );
  const larguraExibida = larguraImagem * escalaBase * zoom;
  const alturaExibida = alturaImagem * escalaBase * zoom;

  return {
    limiteX: Math.max(0, (larguraExibida - tamanhoPreview) / 2),
    limiteY: Math.max(0, (alturaExibida - tamanhoPreview) / 2),
  };
}

function AjustadorFoto({
  foto,
  zoom,
  posicaoX,
  posicaoY,
  onZoom,
  onPosicaoX,
  onPosicaoY,
  onTamanhoPreview,
  onCancelar,
  onConfirmar,
}) {
  const previewRef = useRef(null);
  const arrastandoRef = useRef(false);
  const inicioArrasteRef = useRef({ x: 0, y: 0, posicaoX: 0, posicaoY: 0 });
  const [dimensoesImagem, setDimensoesImagem] = useState({ largura: 0, altura: 0 });
  const [tamanhoPreviewAtual, setTamanhoPreviewAtual] = useState(TAMANHO_PREVIEW_FOTO);

  function limitarPosicao(proximaPosicaoX, proximaPosicaoY, proximoZoom = zoom) {
    const { limiteX, limiteY } = calcularLimitesAjusteFoto(
      dimensoesImagem.largura,
      dimensoesImagem.altura,
      tamanhoPreviewAtual,
      proximoZoom
    );

    return {
      x: limitarNumero(proximaPosicaoX, -limiteX, limiteX),
      y: limitarNumero(proximaPosicaoY, -limiteY, limiteY),
    };
  }

  function alterarZoom(event) {
    const proximoZoom = Number(event.target.value);
    const posicaoLimitada = limitarPosicao(posicaoX, posicaoY, proximoZoom);

    onZoom(proximoZoom);
    onPosicaoX(posicaoLimitada.x);
    onPosicaoY(posicaoLimitada.y);
  }

  function alterarPosicaoX(event) {
    const posicaoLimitada = limitarPosicao(Number(event.target.value), posicaoY);
    onPosicaoX(posicaoLimitada.x);
  }

  function alterarPosicaoY(event) {
    const posicaoLimitada = limitarPosicao(posicaoX, Number(event.target.value));
    onPosicaoY(posicaoLimitada.y);
  }

  function iniciarArraste(event) {
    event.preventDefault();
    arrastandoRef.current = true;
    inicioArrasteRef.current = {
      x: event.clientX,
      y: event.clientY,
      posicaoX,
      posicaoY,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function moverArraste(event) {
    if (!arrastandoRef.current) return;

    const deltaX = event.clientX - inicioArrasteRef.current.x;
    const deltaY = event.clientY - inicioArrasteRef.current.y;
    const posicaoLimitada = limitarPosicao(
      inicioArrasteRef.current.posicaoX + deltaX,
      inicioArrasteRef.current.posicaoY + deltaY
    );

    onPosicaoX(posicaoLimitada.x);
    onPosicaoY(posicaoLimitada.y);
  }

  function finalizarArraste(event) {
    arrastandoRef.current = false;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  }

  useEffect(() => {
    const elementoPreview = previewRef.current;
    if (!elementoPreview) return undefined;

    function atualizarTamanhoPreview() {
      const proximoTamanho = elementoPreview.clientWidth || TAMANHO_PREVIEW_FOTO;
      setTamanhoPreviewAtual(proximoTamanho);
      onTamanhoPreview?.(proximoTamanho);
    }

    atualizarTamanhoPreview();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", atualizarTamanhoPreview);
      return () => window.removeEventListener("resize", atualizarTamanhoPreview);
    }

    const observer = new ResizeObserver(atualizarTamanhoPreview);
    observer.observe(elementoPreview);

    return () => observer.disconnect();
  }, [onTamanhoPreview]);

  const { limiteX, limiteY } = calcularLimitesAjusteFoto(
    dimensoesImagem.largura,
    dimensoesImagem.altura,
    tamanhoPreviewAtual,
    zoom
  );
  const escalaBasePreview =
    dimensoesImagem.largura && dimensoesImagem.altura
      ? Math.max(
        tamanhoPreviewAtual / dimensoesImagem.largura,
        tamanhoPreviewAtual / dimensoesImagem.altura
      )
      : 1;
  const larguraImagemPreview = dimensoesImagem.largura * escalaBasePreview;
  const alturaImagemPreview = dimensoesImagem.altura * escalaBasePreview;

  return (
    <div className="ajustadorFotoOverlay" role="presentation">
      <div
        className="ajustadorFotoModal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ajustadorFotoTitulo"
      >
        <h2 id="ajustadorFotoTitulo">Ajustar foto</h2>

        <div
          ref={previewRef}
          className="ajustadorFotoPreview"
          onPointerDown={iniciarArraste}
          onPointerMove={moverArraste}
          onPointerUp={finalizarArraste}
          onPointerCancel={finalizarArraste}
        >
          <img
            src={foto}
            alt="Ajustar enquadramento"
            draggable="false"
            onLoad={(event) => {
              setDimensoesImagem({
                largura: event.currentTarget.naturalWidth,
                altura: event.currentTarget.naturalHeight,
              });
            }}
            style={{
              width: larguraImagemPreview ? `${larguraImagemPreview}px` : "100%",
              height: alturaImagemPreview ? `${alturaImagemPreview}px` : "100%",
              transform: `translate(-50%, -50%) translate(${posicaoX}px, ${posicaoY}px) scale(${zoom})`,
              transformOrigin: "center center",
            }}
          />
          <span className="ajustadorFotoGrade" aria-hidden="true"></span>
        </div>

        <label>
          Zoom
          <input
            type="range"
            min="1"
            max="3"
            step="0.05"
            value={zoom}
            onChange={alterarZoom}
          />
        </label>

        <label>
          Horizontal
          <input
            type="range"
            min={-limiteX}
            max={limiteX}
            step="1"
            value={posicaoX}
            onChange={alterarPosicaoX}
          />
        </label>

        <label>
          Vertical
          <input
            type="range"
            min={-limiteY}
            max={limiteY}
            step="1"
            value={posicaoY}
            onChange={alterarPosicaoY}
          />
        </label>

        <div className="ajustadorFotoAcoes">
          <button type="button" onClick={onCancelar}>
            Cancelar
          </button>

          <button type="button" onClick={onConfirmar}>
            Confirmar posição
          </button>
        </div>
      </div>
    </div>
  );
}

function App() {
  const [tela, setTelaBase] = useState("inicio");
  const posicoesScrollPorTelaRef = useRef({});
  const telaAtualRef = useRef("inicio");

  function setTela(proximaTela) {
    const destino =
      typeof proximaTela === "function"
        ? proximaTela(telaAtualRef.current)
        : proximaTela;

    posicoesScrollPorTelaRef.current[telaAtualRef.current] = window.scrollY;
    telaAtualRef.current = destino;
    setTelaBase(destino);
  }

  const [usuario, setUsuario] = useState("");
  const [senha, setSenha] = useState("");
  const [tipoUsuario, setTipoUsuario] = useState("");
  const [usuarioLogado, setUsuarioLogado] = useState(null);

  const [avisos, setAvisos] = useState(() => {
    return recuperarDadosSalvos([STORAGE_KEYS.avisos, "avisos_ariramba"], []);
  });
  function adicionarAviso(mensagem) {
    const novoAviso = {
      id: Date.now(),
      mensagem,
      data: new Date().toLocaleString(),
    };

    setAvisos((prev) => [novoAviso, ...prev]);
  }

  function criarAcessoAluno({ id = Date.now(), usuario, senha, nome, alunoId, academiaId }) {
    return {
      id,
      usuario,
      senha,
      cargo: "aluno",
      nome,
      alunoId,
      academiaId,
    };
  }

  function criarAcessoProfessor({ id = Date.now(), usuario, senha, nome }) {
    return {
      id,
      usuario,
      senha,
      cargo: "professor",
      nome,
    };
  }

  function obterUsuarioQRCodeAluno(aluno) {
    if (!aluno) return "";

    if (
      usuarioLogado?.cargo === "aluno" &&
      usuarioLogado?.usuario &&
      String(usuarioLogado.alunoId) === String(aluno.id)
    ) {
      return String(usuarioLogado.usuario).trim();
    }

    const usuarioDoAluno = usuarios.find(
      (usuario) =>
        usuario.cargo === "aluno" &&
        String(usuario.alunoId) === String(aluno.id)
    );

    return String(usuarioDoAluno?.usuario || aluno.usuario || aluno.id || "").trim();
  }

  function criarValorQRCodeAluno(aluno) {
    const identificador = normalizarTextoBusca(obterUsuarioQRCodeAluno(aluno))
      .replace(/\s+/g, ".");

    return identificador ? `AR:${identificador}` : "";
  }

  const [usuarios, setUsuarios] = useState(() => {
    if (supabaseConfigurado) return [];

    return recuperarDadosSalvos(
      [STORAGE_KEYS.usuarios, "usuarios_ariramba"],
      [
        {
          id: 1,
          usuario: "admin",
          senha: "1234",
          cargo: "diretor",
          nome: "Mestre",
        },

        {
          id: 2,
          usuario: "professor",
          senha: "1234",
          cargo: "professor",
          nome: "Professor",
        },

        {
          id: 3,
          usuario: "aluno",
          senha: "1234",
          cargo: "aluno",
          nome: "Aluno Teste",
          alunoId: 1779419714987,
        },
      ]
    );
  });
  const [nome, setNome] = useState("");
  const [dataInicio, setDataInicio] = useState("");
  const [usuarioAluno, setUsuarioAluno] = useState("");
  const [senhaAluno, setSenhaAluno] = useState("");
  const [telefone, setTelefone] = useState("");
  const [faixa, setFaixa] = useState("");
  const [turma, setTurma] = useState("Adultos");
  const [responsavel, setResponsavel] = useState("");
  const [dataNascimento, setDataNascimento] = useState("");
  const [peso, setPeso] = useState("");
  const [grau, setGrau] = useState("");
  const [mensalidade, setMensalidade] = useState("");
  const [vencimento, setVencimento] = useState(String(DIA_COBRANCA_PADRAO));
  const [tipoSanguineo, setTipoSanguineo] = useState("");
  const [saude, setSaude] = useState("");
  const [medicamentos, setMedicamentos] = useState("");
  const [observacoes, setObservacoes] = useState("");
  const [observacaoFinanceira, setObservacaoFinanceira] = useState("");
  const [foto, setFoto] = useState("");

  const [fotoParaAjustar, setFotoParaAjustar] = useState("");
  const [ajusteFotoAberto, setAjusteFotoAberto] = useState(false);
  const [zoomFoto, setZoomFoto] = useState(1);
  const [posicaoFotoX, setPosicaoFotoX] = useState(0);
  const [posicaoFotoY, setPosicaoFotoY] = useState(0);
  const [tamanhoPreviewFoto, setTamanhoPreviewFoto] = useState(TAMANHO_PREVIEW_FOTO);

  const [alunoCarteirinha, setAlunoCarteirinha] = useState(null);
  const [mostrarPix, setMostrarPix] = useState(false);
  const [imagemComprovante, setImagemComprovante] = useState(null);
  const [nomeComprovanteSelecionado, setNomeComprovanteSelecionado] = useState("");
  const [comprovanteSelecionado, setComprovanteSelecionado] = useState(null);
  const [pagamentoEmAndamento, setPagamentoEmAndamento] = useState(false);
  const [menuAberto, setMenuAberto] = useState(false);
  const [mostrarCarteirinhaAluno, setMostrarCarteirinhaAluno] = useState(false);
  const [mostrarHistoricoAluno, setMostrarHistoricoAluno] = useState(false);
  const [modoEditarPerfil, setModoEditarPerfil] = useState(false);
  const [erroArmazenamento, setErroArmazenamento] = useState("");
  const [especialidadeProfessor, setEspecialidadeProfessor] = useState("");
  const [graduacaoProfessor, setGraduacaoProfessor] = useState("");
  const [novaSenha, setNovaSenha] = useState("");
  const [confirmarSenha, setConfirmarSenha] = useState("");
  const [busca, setBusca] = useState("");
  const [filtroTurma, setFiltroTurma] = useState("Todas");
  const [alunoEditando, setAlunoEditando] = useState(null);
  const [sincronizacaoOnline, setSincronizacaoOnline] = useState("");
  const [loginEmAndamento, setLoginEmAndamento] = useState(false);
  const [modalMensagem, setModalMensagem] = useState(null);
  const [salvandoAluno, setSalvandoAluno] = useState(false);
  const [statusScanner, setStatusScanner] = useState("Abrindo camera...");
  const [scannerKey, setScannerKey] = useState(0);
  const [nomeArquivoScanner, setNomeArquivoScanner] = useState("");
  const pagamentoEmAndamentoRef = useRef(false);
  const contextoFotoTemporariaRef = useRef("");
  const registrarPresencaPorQRCodeRef = useRef(null);
  const [horaAtual, setHoraAtual] = useState(
    new Date().toLocaleTimeString()
  );
  const diretorOnlineLogado =
    supabaseConfigurado &&
    tipoUsuario === "diretor" &&
    (usuarioLogado?.origem === "supabase" ||
      usuarioLogado?.origem === "usuarios_sistema");
  const usuarioOnlineLogado =
    supabaseConfigurado &&
    (usuarioLogado?.origem === "supabase" ||
      usuarioLogado?.origem === "usuarios_sistema");
  const modoLocalAtivo = !supabaseConfigurado;

  function obterContextoFotoAtual() {
    if (tela === "cadastro") {
      return alunoEditando
        ? `cadastro-aluno:${alunoEditando.id}`
        : "cadastro-aluno:novo";
    }

    if (tela === "portalProfessor") {
      return `portal-professor:${usuarioLogado?.id || usuarioLogado?.usuario || ""}`;
    }

    if (tela === "portalAluno") {
      return `portal-aluno:${alunoDoPortal?.id || usuarioLogado?.alunoId || usuarioLogado?.usuario || ""}`;
    }

    return "";
  }

  function fotoTemporariaPertenceAoContextoAtual() {
    return (
      String(foto || "").startsWith("data:image/") &&
      contextoFotoTemporariaRef.current === obterContextoFotoAtual()
    );
  }

  function definirFotoTemporaria(fotoTemporaria) {
    contextoFotoTemporariaRef.current = obterContextoFotoAtual();
    setFoto(fotoTemporaria);
  }

  function abrirAjusteFoto(fotoSelecionada) {
    setFotoParaAjustar(fotoSelecionada);
    setZoomFoto(1);
    setPosicaoFotoX(0);
    setPosicaoFotoY(0);
    setTamanhoPreviewFoto(TAMANHO_PREVIEW_FOTO);
    setAjusteFotoAberto(true);
  }

  async function prepararFotoParaAjuste(arquivo) {
    try {
      const fotoCompactada = await lerImagemCompactada(arquivo);
      abrirAjusteFoto(fotoCompactada);
    } catch (error) {
      abrirModalMensagem({
        tipo: "erro",
        titulo: "Erro ao carregar foto",
        mensagem: error.message || "Não foi possível carregar a foto.",
      });
    }
  }

  function cancelarAjusteFoto() {
    setAjusteFotoAberto(false);
    setFotoParaAjustar("");
    setZoomFoto(1);
    setPosicaoFotoX(0);
    setPosicaoFotoY(0);
    setTamanhoPreviewFoto(TAMANHO_PREVIEW_FOTO);
  }

  async function confirmarAjusteFoto() {
    if (!fotoParaAjustar) return;

    try {
      const imagem = new Image();
      imagem.crossOrigin = "anonymous";

      imagem.onload = () => {
        const tamanhoSaida = TAMANHO_FOTO_AJUSTADA;
        const tamanhoPreview = tamanhoPreviewFoto || TAMANHO_PREVIEW_FOTO;

        const canvas = document.createElement("canvas");
        canvas.width = tamanhoSaida;
        canvas.height = tamanhoSaida;

        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#111827";
        ctx.fillRect(0, 0, tamanhoSaida, tamanhoSaida);

        const escalaBase = Math.max(
          tamanhoPreview / imagem.width,
          tamanhoPreview / imagem.height
        );

        const escalaFinal = escalaBase * zoomFoto;

        const larguraExibida = imagem.width * escalaFinal;
        const alturaExibida = imagem.height * escalaFinal;

        const fatorSaida = tamanhoSaida / tamanhoPreview;

        const x =
          (tamanhoPreview / 2 -
            larguraExibida / 2 +
            posicaoFotoX) *
          fatorSaida;

        const y =
          (tamanhoPreview / 2 -
            alturaExibida / 2 +
            posicaoFotoY) *
          fatorSaida;

        ctx.drawImage(
          imagem,
          x,
          y,
          larguraExibida * fatorSaida,
          alturaExibida * fatorSaida
        );

        const fotoRecortada = canvas.toDataURL("image/jpeg", QUALIDADE_FOTO_AJUSTADA);

        definirFotoTemporaria(fotoRecortada);
        cancelarAjusteFoto();
      };

      imagem.onerror = () => {
        abrirModalMensagem({
          tipo: "erro",
          titulo: "Erro ao ajustar foto",
          mensagem: "Não foi possível processar a imagem.",
        });
      };

      imagem.src = fotoParaAjustar;
    } catch (error) {
      abrirModalMensagem({
        tipo: "erro",
        titulo: "Erro ao ajustar foto",
        mensagem: error.message || "Não foi possível ajustar a foto.",
      });
    }
  }

  function abrirModalMensagem({
    tipo = "informacao",
    titulo = "Mensagem",
    mensagem = "",
    botao = "OK",
    aoFechar = null,
  }) {
    setModalMensagem({ tipo, titulo, mensagem, botao, aoFechar });
  }

  function fecharModalMensagem() {
    const aoFechar = modalMensagem?.aoFechar;
    setModalMensagem(null);

    if (typeof aoFechar === "function") {
      aoFechar();
    }
  }

  function avisarPrimeiroAcesso() {
    abrirModalMensagem({
      tipo: "aviso",
      titulo: "Primeiro acesso",
      mensagem: "Por segurança, crie uma nova senha antes de continuar.",
      botao: "Continuar",
    });
  }

  useEffect(() => {
    if (menuAberto) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "auto";
    }

    return () => {
      document.body.style.overflow = "auto";
    };
  }, [menuAberto]);

  useEffect(() => {
    const posicaoSalva = posicoesScrollPorTelaRef.current[tela];
    const posicaoDestino =
      typeof posicaoSalva === "number" ? posicaoSalva : 0;
    const frame = requestAnimationFrame(() => {
      window.scrollTo(0, posicaoDestino);
    });

    return () => cancelAnimationFrame(frame);
  }, [tela]);

  useEffect(() => {
    if (tela === "cadastro" && !alunoEditando) {
      contextoFotoTemporariaRef.current = "";
      setFoto("");
    }
  }, [tela, alunoEditando]);

  const [alunos, setAlunos] = useState(() => {
    if (supabaseConfigurado) return [];

    const alunosSalvos = recuperarDadosSalvos(
      [
        STORAGE_KEYS.alunos,
        "alunos_ariramba",
        "alunos_Ariramba Jiu-Jitsu School",
      ],
      []
    );

    return alunosSalvos.map(normalizarAluno);
  });

  const [presencas, setPresencas] = useState(() => {
    if (supabaseConfigurado) return [];

    return recuperarDadosSalvos(
      [
        STORAGE_KEYS.presencas,
        "presencas_ariramba",
        "presencas_Ariramba Jiu-Jitsu School",
      ],
      []
    );
  });
  const [pagamentos, setPagamentos] = useState([]);

  async function carregarDadosOnlineNoEstado() {
    const [alunosOnline, presencasOnline, pagamentosOnline] = await Promise.all([
      listarAlunosOnline(),
      listarPresencasOnline(),
      listarPagamentosOnline(),
    ]);

    const alunosNormalizados = alunosOnline.map(normalizarAluno);
    const presencasComAlunos = completarPresencasComAlunos(
      presencasOnline,
      alunosNormalizados
    );

    setPresencas(presencasComAlunos);
    setPagamentos(pagamentosOnline);

    const alunosOnlineComDados = aplicarPagamentosNosAlunos(
      aplicarPresencasNosAlunos(alunosNormalizados, presencasComAlunos),
      pagamentosOnline
    );

    setAlunos(alunosOnlineComDados);
    return alunosOnlineComDados;
  }

  function ContadorAnimado({ valor }) {
    return <>{Number(valor) || 0}</>;
  }

  useEffect(() => {
    if (!modoLocalAtivo) return;

    if (salvarDados(STORAGE_KEYS.alunos, alunos)) {
      setErroArmazenamento("");
    } else {
      setErroArmazenamento("Não foi possível salvar os alunos. Faça um backup e reduza fotos muito pesadas.");
    }
  }, [alunos, modoLocalAtivo]);

  useEffect(() => {
    if (!modoLocalAtivo) return;

    if (!salvarDados(STORAGE_KEYS.presencas, presencas)) {
      setErroArmazenamento("Não foi possível salvar o histórico de presenças.");
    }
  }, [presencas, modoLocalAtivo]);

  useEffect(() => {
    salvarDados(STORAGE_KEYS.avisos, avisos);
  }, [avisos]);

  useEffect(() => {
    if (!modoLocalAtivo) return;

    if (!salvarDados(STORAGE_KEYS.usuarios, usuarios)) {
      setErroArmazenamento("Não foi possível salvar os usuários de acesso.");
    }
  }, [usuarios, modoLocalAtivo]);

  useEffect(() => {
    if (usuarioLogado) {
      salvarDados(STORAGE_KEYS.usuarioLogado, usuarioLogado);
    }
  }, [usuarioLogado]);

  useEffect(() => {
    if (
      (tela === "mensalidades" ||
        tela === "pagamentos" ||
        tela === "relatorios") &&
      tipoUsuario !== "diretor"
    ) {
      setTela("dashboard");
    }
  }, [tela, tipoUsuario]);

  useEffect(() => {
    if (tela === "cadastro" && tipoUsuario !== "diretor" && !alunoEditando) {
      setTela("lista");
    }
  }, [tela, tipoUsuario, alunoEditando]);

  useEffect(() => {
    let ativo = true;

    function aplicarUsuarioLogado(usuarioRecuperado) {
      if (!ativo) return;

      setUsuarioLogado(usuarioRecuperado);
      setTipoUsuario(usuarioRecuperado.cargo);

      if (usuarioRecuperado.cargo === "aluno") {
        setTela("portalAluno");
      } else if (usuarioRecuperado.cargo === "professor") {
        setFoto(usuarioRecuperado.foto || usuarioRecuperado.fotoUrl || "");
        setTela("portalProfessor");
      } else {
        setTela("dashboard");
      }
    }

    async function restaurarSessaoInicial() {
      if (supabaseConfigurado) {
        try {
          const perfil = await obterPerfilSupabase();

          if (perfil?.cargo && perfil?.academia_id) {
            aplicarUsuarioLogado({
              id: perfil.id,
              usuario: perfil.email || perfil.id,
              cargo: perfil.cargo,
              nome: perfil.nome || perfil.id,
              alunoId: perfil.aluno_id,
              academiaId: perfil.academia_id,
              origem: "supabase",
            });
            return;
          }
        } catch (error) {
          console.error("Erro ao recuperar sessao do Supabase.", error);
        }
      }

      const usuarioSalvo =
        localStorage.getItem(STORAGE_KEYS.usuarioLogado) ||
        localStorage.getItem("usuario_logado_ariramba");

      if (usuarioSalvo) {
        let usuarioRecuperado;

        try {
          usuarioRecuperado = JSON.parse(usuarioSalvo);
        } catch (error) {
          console.warn("Sessão salva inválida. Login será solicitado novamente.", error);
          localStorage.removeItem(STORAGE_KEYS.usuarioLogado);
          localStorage.removeItem("usuario_logado_ariramba");
          return;
        }

        aplicarUsuarioLogado(usuarioRecuperado);
      }
    }

    restaurarSessaoInicial();

    return () => {
      ativo = false;
    };
  }, []);

  async function registrarPresencaPorQRCode(resultado) {
    const codigoLido = String(resultado || "").trim();
    const idAlunoLido = extrairIdAlunoDoQRCode(codigoLido);

    if (!idAlunoLido) {
      setStatusScanner("QR lido, mas nao e uma carteirinha valida.");
      alert("QR Code lido, mas ele nao parece ser uma carteirinha de presenca deste sistema.");
      return false;
    }

    setStatusScanner("QR lido. Buscando aluno...");
    const chaveBuscaQRCode = normalizarTextoBusca(idAlunoLido);

    let presencasParaBusca = presencas;
    let alunoEncontrado = alunos.find(
      (aluno) =>
        String(aluno.id) === String(idAlunoLido) ||
        normalizarTextoBusca(aluno.usuario) === chaveBuscaQRCode ||
        normalizarTextoBusca(aluno.nome) === chaveBuscaQRCode
    );

    if (!alunoEncontrado) {
      const usuarioDoAluno = usuarios.find(
        (usuario) =>
          usuario.cargo === "aluno" &&
          normalizarTextoBusca(usuario.usuario) === chaveBuscaQRCode
      );

      if (usuarioDoAluno?.alunoId) {
        alunoEncontrado = alunos.find(
          (aluno) => String(aluno.id) === String(usuarioDoAluno.alunoId)
        );
      }
    }

    if (!alunoEncontrado && supabaseConfigurado) {
      try {
        let alunoOnlinePorUsuario = null;

        try {
          const usuarioOnline = await buscarUsuarioSistemaOnline(idAlunoLido);

          if (usuarioOnline?.alunoId) {
            alunoOnlinePorUsuario = await obterAlunoOnline(usuarioOnline.alunoId);
          }
        } catch (error) {
          console.warn("QR nao encontrou usuario online direto.", error);
        }

        const [alunosOnline, presencasOnline, pagamentosOnline] = await Promise.all([
          listarAlunosOnline(),
          listarPresencasOnline(),
          listarPagamentosOnline(),
        ]);
        const alunosNormalizados = alunosOnline.map(normalizarAluno);
        const presencasComAlunos = completarPresencasComAlunos(
          presencasOnline,
          alunosNormalizados
        );
        const alunosOnlineComDados = aplicarPagamentosNosAlunos(
          aplicarPresencasNosAlunos(alunosNormalizados, presencasComAlunos),
          pagamentosOnline
        );

        presencasParaBusca = presencasComAlunos;
        setAlunos(alunosOnlineComDados);
        setPresencas(presencasComAlunos);
        setPagamentos(pagamentosOnline);

        alunoEncontrado = alunosOnlineComDados.find(
          (aluno) =>
            String(aluno.id) === String(idAlunoLido) ||
            normalizarTextoBusca(aluno.usuario) === chaveBuscaQRCode ||
            normalizarTextoBusca(aluno.nome) === chaveBuscaQRCode
        ) || (alunoOnlinePorUsuario ? normalizarAluno(alunoOnlinePorUsuario) : null);
      } catch (error) {
        console.error("Erro ao buscar aluno do QR online.", error);
      }
    }

    if (!alunoEncontrado) {
      setStatusScanner("Aluno nao encontrado para este QR.");
      alert("QR Code lido, mas aluno nao encontrado. Confira se esta usando a carteirinha gerada por este sistema.");
      return false;
    }

    if (verificarVencimento(alunoEncontrado) === "Vencido") {
      const multa = 10;
      const jurosPorDia = 1;
      const diasAtraso = calcularDiasAtraso(alunoEncontrado);
      const valorAtualizado =
        Number(alunoEncontrado.mensalidade || 0) + multa + diasAtraso * jurosPorDia;
      const valorAtualizadoFormatado = Number(valorAtualizado || 0).toLocaleString("pt-BR", {
        style: "currency",
        currency: "BRL",
      });

      setStatusScanner("Presenca bloqueada por mensalidade vencida.");
      alert(
        `Presenca bloqueada.\n\n${alunoEncontrado.nome} esta com mensalidade vencida.\nValor atualizado: ${valorAtualizadoFormatado}`
      );
      return false;
    }

    if (avisarPendenciaFinanceiraNaPresenca(alunoEncontrado)) {
      setStatusScanner(`Aviso financeiro exibido para ${alunoEncontrado.nome}. Registrando presença...`);
    }

    const hoje = new Date().toLocaleDateString();

    const jaRegistrou = presencasParaBusca.some(
      (presenca) =>
        (String(presenca.alunoId) === String(alunoEncontrado.id) ||
          presenca.nome === alunoEncontrado.nome) &&
        presenca.data === hoje
    );

    if (jaRegistrou) {
      setStatusScanner("Aluno ja registrou presenca hoje.");
      alert("Aluno ja registrou presenca hoje.");
      return false;
    }

    const novaPresenca = {
      alunoId: alunoEncontrado.id,
      nome: alunoEncontrado.nome,
      foto: alunoEncontrado.foto,
      data: new Date().toLocaleDateString(),
      hora: new Date().toLocaleTimeString(),
    };

    setStatusScanner("Registrando presenca...");

    if (usuarioOnlineLogado) {
      try {
        await registrarPresencaOnline(novaPresenca);
      } catch (error) {
        console.error("Erro ao registrar presenca online.", error);
        setStatusScanner("Nao foi possivel salvar a presenca online.");
        alert(`Nao foi possivel enviar a presenca ao banco online.\n\nErro: ${error.message}`);
        return false;
      }
    }

    setAlunos((prev) =>
      prev.map((aluno) =>
        String(aluno.id) === String(alunoEncontrado.id)
          ? {
            ...aluno,
            presencas: [...(aluno.presencas || []), {
              data: novaPresenca.data,
              hora: novaPresenca.hora,
            }],
          }
          : aluno
      )
    );

    setPresencas((prev) => [...prev, novaPresenca]);
    adicionarAviso(`${alunoEncontrado.nome} registrou presenca`);
    setStatusScanner(`Presenca registrada para ${alunoEncontrado.nome}.`);
    alert("Presenca registrada para " + alunoEncontrado.nome);
    return true;
  }

  registrarPresencaPorQRCodeRef.current = registrarPresencaPorQRCode;

  useEffect(() => {
    if (tela !== "scanner") return;

    const scanner = new Html5Qrcode("reader");
    let leituraEmAndamento = false;
    let scannerAtivo = true;

    const liberarScanner = () => {
      setTimeout(() => {
        leituraEmAndamento = false;
      }, 1800);
    };

    const processarQrCode = async (resultado) => {
      if (leituraEmAndamento) return;
      leituraEmAndamento = true;
      setStatusScanner("QR lido. Processando...");
      await registrarPresencaPorQRCodeRef.current?.(resultado);
      liberarScanner();
    };

    setStatusScanner("Abrindo camera...");
    scanner
      .start(
        { facingMode: "environment" },
        { fps: 15, qrbox: { width: 280, height: 280 }, aspectRatio: 1 },
        processarQrCode,
        () => { }
      )
      .then(() => {
        if (scannerAtivo) {
          setStatusScanner("Camera aberta. Aponte para o QR da carteirinha.");
        }
      })
      .catch((error) => {
        console.error("Erro ao iniciar camera do scanner.", error);
        setStatusScanner("Nao foi possivel abrir a camera.");
        alert("Nao foi possivel abrir a camera. Permita o acesso a camera e tente novamente.");
      });

    return () => {
      scannerAtivo = false;
      try {
        const paradaScanner = scanner.stop();

        Promise.resolve(paradaScanner)
          .catch(() => { })
          .finally(() => {
            try {
              scanner.clear();
            } catch (error) {
              console.warn("Scanner ja estava limpo ao sair da tela.", error);
            }

            document.getElementById("reader")?.replaceChildren();
          });
      } catch (error) {
        console.warn("Scanner ja estava parado ao sair da tela.", error);

        try {
          scanner.clear();
        } catch (erroLimpeza) {
          console.warn("Scanner ja estava limpo ao sair da tela.", erroLimpeza);
        }

        document.getElementById("reader")?.replaceChildren();
      }
    };
  }, [tela, scannerKey]);

  useEffect(() => {
    const relogio = setInterval(() => {
      setHoraAtual(new Date().toLocaleTimeString());
    }, 1000);

    return () => clearInterval(relogio);
  }, []);

  useEffect(() => {
    const telasComDadosOnline = [
      "dashboard",
      "lista",
      "pagamentos",
      "historico",
      "portalAluno",
      "portalProfessor",
    ];

    if (!usuarioOnlineLogado || !telasComDadosOnline.includes(tela)) {
      return;
    }

    let componenteAtivo = true;

    async function sincronizarPainel() {
      try {
        if (!componenteAtivo) return;
        await carregarDadosOnlineNoEstado();
      } catch (error) {
        console.error("Erro ao sincronizar painel online.", error);
        if (componenteAtivo) {
          setErroArmazenamento(
            `Não foi possível carregar os dados online: ${error.message || "erro desconhecido"}`
          );
        }
      }
    }

    sincronizarPainel();
    const intervalo = setInterval(sincronizarPainel, tela === "portalAluno" ? 5000 : 10000);

    return () => {
      componenteAtivo = false;
      clearInterval(intervalo);
    };
  }, [tela, usuarioOnlineLogado, usuarioLogado?.id, usuarioLogado?.academiaId]);

  useEffect(() => {
    if (!usuarioOnlineLogado || !supabase) return;

    const canal = supabase
      .channel(`alunos-sync-${usuarioLogado?.id || usuarioLogado?.usuario || "online"}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "alunos" },
        () => {
          carregarDadosOnlineNoEstado().catch((error) => {
            console.error("Erro ao recarregar alunos apos evento realtime.", error);
          });
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "presencas" },
        () => {
          carregarDadosOnlineNoEstado().catch((error) => {
            console.error("Erro ao recarregar presencas apos evento realtime.", error);
          });
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "pagamentos" },
        () => {
          carregarDadosOnlineNoEstado().catch((error) => {
            console.error("Erro ao recarregar pagamentos apos evento realtime.", error);
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(canal);
    };
  }, [usuarioLogado?.id, usuarioLogado?.usuario, usuarioOnlineLogado]);

  function limparFormulario() {
    contextoFotoTemporariaRef.current = "";
    setNome("");
    setDataInicio("");
    setUsuarioAluno("");
    setSenhaAluno("");
    setTelefone("");
    setFaixa("");
    setTurma("Adultos");
    setResponsavel("");
    setDataNascimento("");
    setPeso("");
    setGrau("");
    setTipoSanguineo("");
    setSaude("");
    setMedicamentos("");
    setObservacoes("");
    setObservacaoFinanceira("");
    setFoto("");
    setAlunoEditando(null);
    setMensalidade("");
    setVencimento(String(DIA_COBRANCA_PADRAO));
    setNovaSenha("");
    setConfirmarSenha("");
  }

  async function salvarAluno() {
    if (salvandoAluno) return;

    if (nome.trim() === "") {
      alert("Digite o nome do aluno.");
      return;
    }

    if (supabaseConfigurado && !diretorOnlineLogado && !alunoEditando) {
      alert("Entre com o diretor online antes de cadastrar alunos.");
      return;
    }

    if (supabaseConfigurado && !usuarioOnlineLogado) {
      alert("Entre com uma conta online antes de alterar alunos.");
      return;
    }

    const usuarioInformado = usuarioAluno.trim();
    const senhaInformada = senhaAluno.trim();
    const usuarioAtualDoAluno = alunoEditando
      ? usuarios.find((usuario) => usuario.alunoId === alunoEditando.id)
      : null;
    const usuarioNormalizado =
      usuarioInformado || usuarioAtualDoAluno?.usuario || criarUsuarioAluno(nome, usuarios);
    const senhaNormalizada =
      senhaInformada || (!alunoEditando || !usuarioAtualDoAluno ? "1234" : "");
    const professorEditandoAluno = tipoUsuario === "professor" && alunoEditando;

    if (
      usuarioNormalizado !== "" &&
      usuarios.some(
        (usuario) =>
          usuario.usuario.toLowerCase() === usuarioNormalizado.toLowerCase() &&
          usuario.alunoId !== alunoEditando?.id
      )
    ) {
      alert("Este usuário já existe. Escolha outro usuário para o aluno.");
      return;
    }

    if (diretorOnlineLogado && usuarioNormalizado) {
      try {
        const usuarioOnlineExistente = await buscarUsuarioSistemaOnline(usuarioNormalizado);
        const usuarioDoMesmoAluno =
          alunoEditando &&
          usuarioOnlineExistente?.alunoId &&
          String(usuarioOnlineExistente.alunoId) === String(alunoEditando.id);

        if (usuarioOnlineExistente && !usuarioDoMesmoAluno) {
          alert("Este usuário já existe no banco online. Escolha outro usuário para o aluno.");
          return;
        }
      } catch (error) {
        console.error("Erro ao validar usuário online do aluno.", error);
        alert(`Não foi possível validar o usuário no banco online.\n\nErro: ${error.message || "erro desconhecido"}`);
        return;
      }
    }

    setSalvandoAluno(true);

    if (alunoEditando) {
      let alunoAtualizado = null;
      const alunosAtualizados = alunos.map((aluno) => {
        if (aluno.id === alunoEditando.id) {
          alunoAtualizado = {
            ...aluno,
            ...(professorEditandoAluno
              ? {
                observacoes,
              }
              : {
                nome,
                telefone,
                faixa,
                turma,
                responsavel,
                dataNascimento,
                peso,
                grau,
                tipoSanguineo,
                saude,
                medicamentos,
                observacoes,
                observacaoFinanceira,
                foto,
                fotoUrl: foto,
                mensalidade: Number(mensalidade),
                vencimento: Number(vencimento || DIA_COBRANCA_PADRAO),
              }),
            academiaId: aluno.academiaId || usuarioLogado?.academiaId || "",
          };

          return alunoAtualizado;
        }

        return aluno;
      });

      if (supabaseConfigurado && alunoAtualizado) {
        try {
          const alunoOnline = await salvarAlunoOnline(alunoAtualizado);
          alunoAtualizado = normalizarAluno(alunoOnline);
          setAlunos(
            alunosAtualizados.map((aluno) =>
              aluno.id === alunoEditando.id ? alunoAtualizado : aluno
            )
          );
        } catch (error) {
          console.error("Erro ao atualizar aluno online.", error);
          alert(`Nao foi possivel atualizar o aluno no banco online.\n\nErro: ${error.message || "erro desconhecido"}`);
          setSalvandoAluno(false);
          return;
        }
      } else {
        setAlunos(alunosAtualizados);
      }

      const alunoIdParaAcesso = alunoAtualizado?.id || alunoEditando.id;

      if (tipoUsuario === "diretor") {
        setUsuarios((usuariosAtuais) => {
          if (usuarioAtualDoAluno) {
            return usuariosAtuais.map((usuario) => {
              if (usuario.alunoId === alunoEditando.id) {
                return {
                  ...usuario,
                  usuario: usuarioNormalizado,
                  senha: senhaNormalizada || usuario.senha,
                  nome,
                  alunoId: alunoIdParaAcesso,
                  academiaId: usuario.academiaId || usuarioLogado?.academiaId || alunoAtualizado?.academiaId || "",
                };
              }

              return usuario;
            });
          }

          return [
            ...usuariosAtuais,
            {
              id: Date.now(),
              usuario: usuarioNormalizado,
              senha: senhaNormalizada,
              cargo: "aluno",
              nome,
              alunoId: alunoIdParaAcesso,
              academiaId: usuarioLogado?.academiaId || alunoAtualizado?.academiaId || "",
            },
          ];
        });
      }

      if (diretorOnlineLogado) {
        try {
          if (!idAlunoOnlineValido(alunoIdParaAcesso)) {
            throw new Error("Aluno ainda nao possui ID online valido.");
          }

          await salvarUsuarioSistemaOnline(
            criarAcessoAluno({
              id: usuarioAtualDoAluno?.id || Date.now(),
              usuario: usuarioNormalizado,
              senha: senhaNormalizada || usuarioAtualDoAluno?.senha || "1234",
              nome,
              alunoId: alunoIdParaAcesso,
              academiaId: usuarioLogado?.academiaId || alunoAtualizado?.academiaId || "",
            })
          );
        } catch (error) {
          console.error("Erro ao salvar usuário do aluno online.", error);
          alert(`Aluno atualizado, mas o acesso online não foi salvo.\n\nErro: ${error.message || "erro desconhecido"}`);
        }
      }

      setAlunoEditando(null);

      limparFormulario();

      setSalvandoAluno(false);
      setTela("lista");

      setTimeout(() => {
        alert("Aluno atualizado com sucesso.");
      }, 0);
      return;
    }

    const novoAluno = {
      id: criarIdAluno(),

      nome,
      peso,
      dataNascimento,
      faixa,
      turma,
      dataInicio,

      usuario: usuarioNormalizado,
      senha: senhaNormalizada,

      telefone,
      responsavel,

      tipoSanguineo,
      saude,
      medicamentos,
      observacoes,

      foto,

      grau,

      presencas: [],

      mensalidade: Number(mensalidade),

      vencimento: Number(vencimento || DIA_COBRANCA_PADRAO),

      statusPagamento: "Pendente",
      ultimoPagamento: "",
      historicoPagamentos: [],
      academiaId: usuarioLogado?.academiaId || "",
    };
    let alunoParaSalvar = novoAluno;
    let acessoAluno = null;

    if (diretorOnlineLogado) {
      try {
        alunoParaSalvar = normalizarAluno(await salvarAlunoOnline(novoAluno));

        if (!idAlunoOnlineValido(alunoParaSalvar.id)) {
          throw new Error("Aluno cadastrado sem ID online valido para vincular o acesso.");
        }

        acessoAluno = criarAcessoAluno({
          usuario: usuarioNormalizado,
          senha: senhaNormalizada,
          nome,
          alunoId: alunoParaSalvar.id,
          academiaId: usuarioLogado?.academiaId || alunoParaSalvar.academiaId || "",
        });

        await salvarUsuarioSistemaOnline(acessoAluno);
      } catch (error) {
        console.error("Erro ao concluir cadastro online do aluno.", error);
        await desfazerAlunoOnlineCriado(alunoParaSalvar?.id);
        alert(`Nao foi possivel concluir o cadastro online do aluno.\n\nErro: ${error.message || "erro desconhecido"}`);
        setSalvandoAluno(false);
        return;
      }
    }

    acessoAluno = acessoAluno || criarAcessoAluno({
      usuario: usuarioNormalizado,
      senha: senhaNormalizada,
      nome,
      alunoId: alunoParaSalvar.id,
      academiaId: usuarioLogado?.academiaId || alunoParaSalvar.academiaId || "",
    });

    setAlunos((alunosAtuais) =>
      mesclarAlunosPreservandoLocais(alunosAtuais, [alunoParaSalvar])
    );
    setUsuarios((usuariosAtuais) => [...usuariosAtuais, acessoAluno]);

    adicionarAviso(`Novo aluno cadastrado: ${nome}`);

    alert(`Aluno ${nome} cadastrado com sucesso!\n\nAcesso do portal:\nUsuario: ${usuarioNormalizado}\nSenha: ${senhaNormalizada}`);

    limparFormulario();
    setSalvandoAluno(false);
    setTela("dashboard");
  }

  async function marcarComoPago(idAluno) {
    if (pagamentoEmAndamentoRef.current) return;

    pagamentoEmAndamentoRef.current = true;
    setPagamentoEmAndamento(true);
    const dataPagamento = new Date().toLocaleDateString();
    const novosAlunos = alunos.map((aluno) => {
      if (aluno.id === idAluno) {
        return {
          ...aluno,
          statusPagamento: "Pago",
          ultimoPagamento: dataPagamento,
          historicoPagamentos: [
            ...aluno.historicoPagamentos,
            { data: dataPagamento, valor: calcularValorComJuros(aluno) },
          ],
          comprovantePagamento: null,
          dataEnvioComprovante: "",
        };
      }
      return aluno;
    });

    const alunoPago = alunos.find((aluno) => aluno.id === idAluno);
    const alunoAtualizado = novosAlunos.find((aluno) => aluno.id === idAluno);
    if (!alunoPago || !alunoAtualizado) {
      pagamentoEmAndamentoRef.current = false;
      setPagamentoEmAndamento(false);
      return;
    }

    if (diretorOnlineLogado) {
      try {
        const pagamentosOnlineAtuais = await listarPagamentosOnline();
        const pagamentoAguardando = obterPagamentoAguardandoAberto(
          idAluno,
          pagamentosOnlineAtuais
        );
        const pagamentoPagoNoCiclo = pagamentosOnlineAtuais.find(
          (pagamento) =>
            String(pagamento.aluno_id) === String(idAluno) &&
            pagamento.status === "Pago" &&
            pagamentoNoCicloAtual(pagamento)
        );

        if (!pagamentoAguardando && pagamentoPagoNoCiclo) {
          setAlunos(novosAlunos);
          await carregarDadosOnlineNoEstado();
          alert("Este pagamento já está confirmado.");
          return;
        }

        await Promise.all([
          salvarAlunoOnline(alunoAtualizado),
          salvarPagamentoOnline({
            ...(pagamentoAguardando?.id ? { id: pagamentoAguardando.id } : {}),
            aluno_id: idAluno,
            valor: calcularValorComJuros(alunoPago),
            status: "Pago",
            data_pagamento: new Date().toISOString().slice(0, 10),
            comprovante_url:
              alunoPago.comprovantePagamento ||
              pagamentoAguardando?.comprovante_url ||
              null,
          }),
        ]);
        setAlunos(novosAlunos);
        await carregarDadosOnlineNoEstado();
      } catch (error) {
        console.error("Erro ao salvar pagamento online.", error);
        await carregarDadosOnlineNoEstado().catch((erroSincronizacao) => {
          console.error("Erro ao restaurar dados apos falha no pagamento.", erroSincronizacao);
        });
        alert(`Nao foi possivel confirmar o pagamento no banco online.\n\nErro: ${error.message || "erro desconhecido"}`);
        return;
      } finally {
        pagamentoEmAndamentoRef.current = false;
        setPagamentoEmAndamento(false);
      }
    } else {
      setAlunos(novosAlunos);
      pagamentoEmAndamentoRef.current = false;
      setPagamentoEmAndamento(false);
    }

    adicionarAviso(`Pagamento confirmado: ${alunoPago.nome}`);
    alert("Pagamento marcado como Pago.");
  }

  async function marcarComoPendente(idAluno) {
    const novosAlunos = alunos.map((aluno) => {
      if (aluno.id === idAluno) {
        return { ...aluno, statusPagamento: "Pendente" };
      }
      return aluno;
    });

    const alunoAtualizado = novosAlunos.find((aluno) => aluno.id === idAluno);
    if (!alunoAtualizado) return;

    if (diretorOnlineLogado) {
      try {
        await Promise.all([
          salvarAlunoOnline(alunoAtualizado),
          salvarPagamentoOnline({
            aluno_id: idAluno,
            valor: Number(alunoAtualizado.mensalidade || 0),
            status: "Pendente",
            data_pagamento: null,
          }),
        ]);
        setAlunos(novosAlunos);
        await carregarDadosOnlineNoEstado();
      } catch (error) {
        console.error("Erro ao salvar pendencia online.", error);
        await carregarDadosOnlineNoEstado().catch((erroSincronizacao) => {
          console.error("Erro ao restaurar dados apos falha na pendencia.", erroSincronizacao);
        });
        alert(`Nao foi possivel marcar o pagamento como pendente no banco online.\n\nErro: ${error.message || "erro desconhecido"}`);
        return;
      }
    } else {
      setAlunos(novosAlunos);
    }

    alert("Pagamento marcado como Pendente.");
  }

  async function atualizarPerfilAluno() {
    const alunoPerfil = alunoDoPortal;
    const usuarioNormalizado = usuarioAluno.trim();

    if (!alunoPerfil) {
      abrirModalMensagem({
        tipo: "erro",
        titulo: "Aluno não encontrado",
        mensagem: "Aluno não encontrado.",
      });
      return;
    }

    if (!usuarioNormalizado) {
      abrirModalMensagem({
        tipo: "aviso",
        titulo: "Usuário obrigatório",
        mensagem: "Informe um usuario para acessar o portal.",
      });
      return;
    }

    if (novaSenha && novaSenha !== confirmarSenha) {
      abrirModalMensagem({
        tipo: "aviso",
        titulo: "Senhas diferentes",
        mensagem: "As senhas não coincidem.",
      });
      return;
    }

    const usuarioJaExiste = usuarios.some((usuario) => {
      const mesmoUsuario =
        usuario.usuario?.trim().toLowerCase() === usuarioNormalizado.toLowerCase();
      const usuarioDoMesmoAluno =
        String(usuario.alunoId) === String(alunoPerfil.id) ||
        String(usuario.id) === String(usuarioLogado?.id);

      return mesmoUsuario && !usuarioDoMesmoAluno;
    });

    if (usuarioJaExiste) {
      abrirModalMensagem({
        tipo: "aviso",
        titulo: "Usuário em uso",
        mensagem: "Este usuario ja esta em uso. Escolha outro.",
      });
      return;
    }

    const alunosAtualizados = alunos.map((aluno) => {
      if (String(aluno.id) === String(alunoPerfil.id)) {
        return {
          ...aluno,
          usuario: usuarioNormalizado,
          telefone,
          responsavel,
          tipoSanguineo,
          saude,
          medicamentos,
          observacoes,
          foto,
        };
      }

      return aluno;
    });

    const alunoAtualizado = alunosAtualizados.find(
      (aluno) => String(aluno.id) === String(alunoPerfil.id)
    );

    if (supabaseConfigurado) {
      if (!idAlunoOnlineValido(alunoPerfil.id)) {
        abrirModalMensagem({
          tipo: "erro",
          titulo: "ID online inválido",
          mensagem: "Este aluno ainda nao possui um ID online valido. Peça ao mestre para recarregar o aluno pelo Supabase.",
        });
        return;
      }

      try {
        const alunoOnline = normalizarAluno(await salvarAlunoOnline(alunoAtualizado));
        setAlunos((alunosAtuais) =>
          alunosAtuais.map((aluno) =>
            String(aluno.id) === String(alunoOnline.id) ? alunoOnline : aluno
          )
        );
      } catch (error) {
        console.error("Erro ao atualizar cadastro do aluno online.", error);
        abrirModalMensagem({
          tipo: "erro",
          titulo: "Erro ao salvar cadastro",
          mensagem: `Nao foi possivel salvar seu cadastro no banco online.\n\nErro: ${error.message || "erro desconhecido"}`,
        });
        return;
      }
    } else {
      setAlunos(alunosAtualizados);
    }

    const usuariosAtualizados = usuarios.map((usuario) => {

      if (
        String(usuario.alunoId) === String(alunoPerfil.id) ||
        String(usuario.id) === String(usuarioLogado?.id) ||
        usuario.usuario?.trim().toLowerCase() === usuarioLogado?.usuario?.trim().toLowerCase()
      ) {

        return {
          ...usuario,
          usuario: usuarioNormalizado,
          senha: novaSenha || usuario.senha,
          alunoId: alunoPerfil.id,
          academiaId: usuario.academiaId || usuarioLogado?.academiaId || alunoPerfil.academiaId || "",
        };

      }

      return usuario;

    });

    setUsuarios(usuariosAtualizados);

    const usuarioLogadoAtualizado = usuariosAtualizados.find(
      (usuario) =>
        String(usuario.id) === String(usuarioLogado?.id) ||
        usuario.usuario?.trim().toLowerCase() === usuarioLogado?.usuario?.trim().toLowerCase()
    );

    if (usuarioLogadoAtualizado) {
      setUsuarioLogado({
        ...usuarioLogadoAtualizado,
        usuario: usuarioNormalizado,
      });
    }

    const concluirAtualizacaoPerfilAluno = () => {
      setModoEditarPerfil(false);

      abrirModalMensagem({
        tipo: "sucesso",
        titulo: "Perfil atualizado",
        mensagem: "Perfil atualizado com sucesso.",
      });
    };

    if (usuarioOnlineLogado) {
      const usuarioAtualizado = usuariosAtualizados.find(
        (usuario) =>
          String(usuario.alunoId) === String(alunoPerfil.id) ||
          usuario.usuario?.trim().toLowerCase() === usuarioLogado?.usuario?.trim().toLowerCase()
      );

      try {
        if (usuarioAtualizado && usuarioLogado?.origem === "usuarios_sistema") {
          await salvarUsuarioSistemaOnline(usuarioAtualizado);
        }
      } catch (error) {
        console.error("Erro ao atualizar acesso do aluno online.", error);
        abrirModalMensagem({
          tipo: "erro",
          titulo: "Erro ao atualizar acesso",
          mensagem: `Cadastro salvo, mas nao foi possivel atualizar o acesso online.\n\nErro: ${error.message || "erro desconhecido"}`,
          aoFechar: concluirAtualizacaoPerfilAluno,
        });
        return;
      }
    }

    concluirAtualizacaoPerfilAluno();
  }

  async function salvarProfessor() {
    const nomeProfessor = nome.trim();
    const usuarioProfessor = usuarioAluno.trim();
    const senhaProfessor = senhaAluno.trim();

    if (!nomeProfessor) {
      alert("Digite o nome do professor.");
      return;
    }

    if (!usuarioProfessor) {
      alert("Digite o usuário do professor.");
      return;
    }

    if (!senhaProfessor) {
      alert("Digite a senha do professor.");
      return;
    }

    const usuarioJaExiste = usuarios.some(
      (usuario) =>
        usuario.usuario?.trim().toLowerCase() === usuarioProfessor.toLowerCase()
    );

    if (usuarioJaExiste) {
      alert("Este usuário já existe. Escolha outro usuário para o professor.");
      return;
    }

    if (diretorOnlineLogado) {
      try {
        const usuarioOnlineExistente = await buscarUsuarioSistemaOnline(usuarioProfessor);

        if (usuarioOnlineExistente) {
          alert("Este usuário já existe no banco online. Escolha outro usuário para o professor.");
          return;
        }
      } catch (error) {
        console.error("Erro ao validar usuário online do professor.", error);
        alert(`Não foi possível validar o usuário no banco online.\n\nErro: ${error.message || "erro desconhecido"}`);
        return;
      }
    }

    let novoProfessor = criarAcessoProfessor({
      usuario: usuarioProfessor,
      senha: senhaProfessor,
      nome: nomeProfessor,
    });

    if (diretorOnlineLogado) {
      try {
        const professorOnline = await salvarUsuarioSistemaOnline(novoProfessor);
        novoProfessor = {
          ...novoProfessor,
          id: professorOnline.id,
          origem: "usuarios_sistema",
        };
      } catch (error) {
        console.error("Erro ao salvar professor online.", error);
        alert(
          `Não foi possível cadastrar o professor no banco online.\n\nErro: ${error.message || "erro desconhecido"
          }`
        );
        return;
      }
    }

    setUsuarios((usuariosAtuais) => [...usuariosAtuais, novoProfessor]);

    alert("Professor cadastrado com sucesso.");
    limparFormulario();
    setTela("dashboard");
  }

  function abrirEdicaoAcessoMestre() {
    setUsuarioAluno(usuarioLogado?.usuario || "");
    setNovaSenha("");
    setConfirmarSenha("");
    setModoEditarPerfil(true);
  }

  async function atualizarAcessoMestre() {
    const usuarioNormalizado = usuarioAluno.trim();

    if (!usuarioLogado || tipoUsuario !== "diretor") {
      alert("Entre como mestre/diretor para alterar este acesso.");
      return;
    }

    if (!usuarioNormalizado) {
      alert("Informe o novo usuário do mestre.");
      return;
    }

    if (novaSenha && novaSenha !== confirmarSenha) {
      alert("As senhas não coincidem.");
      return;
    }

    if (diretorOnlineLogado && !novaSenha && !usuarioLogado.senha && !senha) {
      alert("Informe uma nova senha para salvar este acesso online.");
      return;
    }

    const usuarioAtual = usuarioLogado.usuario?.trim().toLowerCase();
    const usuarioNovo = usuarioNormalizado.toLowerCase();
    const usuarioJaExiste = usuarios.some((usuario) => {
      const mesmoId = String(usuario.id) === String(usuarioLogado.id);
      const mesmoUsuarioAtual =
        usuario.usuario?.trim().toLowerCase() === usuarioAtual;
      const mesmoUsuarioNovo =
        usuario.usuario?.trim().toLowerCase() === usuarioNovo;

      return mesmoUsuarioNovo && !mesmoId && !mesmoUsuarioAtual;
    });

    if (usuarioJaExiste) {
      alert("Este usuário já está em uso. Escolha outro.");
      return;
    }

    const usuarioBase = {
      ...usuarioLogado,
      usuario: usuarioNormalizado,
      senha: novaSenha || usuarioLogado.senha || senha,
      cargo: "diretor",
      nome: usuarioLogado.nome || "Mestre",
    };

    let atualizouLista = false;
    const usuariosAtualizados = usuarios.map((usuario) => {
      const mesmoId = String(usuario.id) === String(usuarioLogado.id);
      const mesmoUsuarioAtual =
        usuario.usuario?.trim().toLowerCase() === usuarioAtual;

      if (mesmoId || mesmoUsuarioAtual) {
        atualizouLista = true;
        return {
          ...usuario,
          ...usuarioBase,
          id: usuario.id || usuarioBase.id,
        };
      }

      return usuario;
    });

    if (!atualizouLista) {
      usuariosAtualizados.push(usuarioBase);
    }

    setUsuarios(usuariosAtualizados);
    setUsuarioLogado(usuarioBase);

    if (diretorOnlineLogado) {
      try {
        const usuarioOnline = await salvarUsuarioSistemaOnline(usuarioBase);

        if (usuarioOnline?.id) {
          const usuarioComIdOnline = {
            ...usuarioBase,
            id: usuarioOnline.id,
            origem: "usuarios_sistema",
          };

          setUsuarioLogado(usuarioComIdOnline);
          setUsuarios((usuariosAtuais) =>
            usuariosAtuais.map((usuario) => {
              const mesmoUsuarioNovo =
                usuario.usuario?.trim().toLowerCase() === usuarioNovo;
              const mesmoUsuarioAtual =
                usuario.usuario?.trim().toLowerCase() === usuarioAtual;

              if (mesmoUsuarioNovo || mesmoUsuarioAtual) {
                return {
                  ...usuario,
                  ...usuarioComIdOnline,
                };
              }

              return usuario;
            })
          );
        }
      } catch (error) {
        console.error("Erro ao atualizar acesso do mestre online.", error);
        alert(
          `Acesso atualizado neste navegador, mas não foi possível salvar online.\n\nErro: ${error.message || "erro desconhecido"
          }`
        );
        return;
      }
    }

    setModoEditarPerfil(false);
    setNovaSenha("");
    setConfirmarSenha("");
    alert("Usuário e senha do mestre atualizados.");
  }

  async function atualizarPerfilProfessor() {
    const usuarioNormalizado = usuarioAluno.trim() || usuarioLogado?.usuario || "";

    if (!usuarioNormalizado) {
      abrirModalMensagem({
        tipo: "aviso",
        titulo: "Usuário obrigatório",
        mensagem: "Informe o usuário do professor.",
      });
      return;
    }

    if (novaSenha !== confirmarSenha) {
      abrirModalMensagem({
        tipo: "aviso",
        titulo: "Senhas diferentes",
        mensagem: "As senhas não coincidem.",
      });
      return;
    }

    const usuarioAtual = usuarioLogado.usuario?.trim().toLowerCase();
    const usuarioNovo = usuarioNormalizado.toLowerCase();
    const usuarioJaExiste = usuarios.some((usuario) => {
      const mesmoId = String(usuario.id) === String(usuarioLogado.id);
      const mesmoUsuarioAtual =
        usuario.usuario?.trim().toLowerCase() === usuarioAtual;
      const mesmoUsuarioNovo =
        usuario.usuario?.trim().toLowerCase() === usuarioNovo;

      return mesmoUsuarioNovo && !mesmoId && !mesmoUsuarioAtual;
    });

    if (usuarioJaExiste) {
      abrirModalMensagem({
        tipo: "aviso",
        titulo: "Usuário em uso",
        mensagem: "Este usuário já está em uso. Escolha outro.",
      });
      return;
    }

    const dadosProfessorAtualizados = {
      ...usuarioLogado,
      usuario: usuarioNormalizado,
      senha: novaSenha || usuarioLogado.senha,
      cargo: "professor",
      nome: usuarioLogado.nome,
      telefone,
      especialidadeProfessor,
      graduacaoProfessor,
      observacoes,
      foto,
      fotoUrl:
        usuarioLogado.fotoUrl ||
        (!fotoProfessorPrecisaUpload(foto) ? foto : ""),
    };

    const usuariosAtualizados = usuarios.map((usuario) => {
      if (
        String(usuario.id) === String(usuarioLogado.id) ||
        usuario.usuario?.trim().toLowerCase() === usuarioAtual
      ) {
        return {
          ...usuario,
          ...dadosProfessorAtualizados,
          id: usuario.id || dadosProfessorAtualizados.id,
        };
      }

      return usuario;
    });

    setUsuarios(usuariosAtualizados);
    setUsuarioLogado(dadosProfessorAtualizados);

    if (supabaseConfigurado) {
      try {
        const usuarioOnline = await salvarUsuarioSistemaOnline(dadosProfessorAtualizados);

        if (usuarioOnline?.id) {
          let fotoUrlProfessor =
            usuarioOnline.foto_url ||
            dadosProfessorAtualizados.fotoUrl ||
            "";

          if (fotoProfessorPrecisaUpload(foto)) {
            const caminhoFotoProfessor = `professores/${usuarioOnline.id}/foto.jpg`;
            await enviarArquivoOnline(
              "fotos-professores",
              caminhoFotoProfessor,
              converterDataUrlParaBlob(foto)
            );

            const { data: fotoPublica } = supabase.storage
              .from("fotos-professores")
              .getPublicUrl(caminhoFotoProfessor);

            fotoUrlProfessor = fotoPublica?.publicUrl || "";

            if (!fotoUrlProfessor) {
              throw new Error("O Storage nao retornou a URL publica da foto do professor.");
            }

            await salvarUsuarioSistemaOnline({
              ...dadosProfessorAtualizados,
              id: usuarioOnline.id,
              fotoUrl: fotoUrlProfessor,
              origem: "usuarios_sistema",
            });
          }

          const professorComIdOnline = {
            ...dadosProfessorAtualizados,
            id: usuarioOnline.id,
            foto: fotoUrlProfessor || dadosProfessorAtualizados.foto,
            fotoUrl: fotoUrlProfessor,
            origem: "usuarios_sistema",
          };

          setFoto(professorComIdOnline.foto || professorComIdOnline.fotoUrl || "");
          setUsuarioLogado(professorComIdOnline);
          setUsuarios((usuariosAtuais) =>
            usuariosAtuais.map((usuario) => {
              const mesmoUsuarioAtual =
                usuario.usuario?.trim().toLowerCase() === usuarioAtual;
              const mesmoUsuarioNovo =
                usuario.usuario?.trim().toLowerCase() === usuarioNovo;

              if (mesmoUsuarioAtual || mesmoUsuarioNovo) {
                return {
                  ...usuario,
                  ...professorComIdOnline,
                };
              }

              return usuario;
            })
          );
        }
      } catch (error) {
        console.error("Erro ao atualizar professor online.", error);
        abrirModalMensagem({
          tipo: "erro",
          titulo: "Erro ao salvar online",
          mensagem: `Cadastro atualizado neste navegador, mas não foi possível salvar online.\n\nErro: ${error.message || "erro desconhecido"
            }`,
        });
        return;
      }
    }

    setModoEditarPerfil(false);
    setNovaSenha("");
    setConfirmarSenha("");

    abrirModalMensagem({
      tipo: "sucesso",
      titulo: "Cadastro atualizado",
      mensagem: "Cadastro do professor atualizado.",
    });
  }

  async function informarPagamento(idAluno, comprovante = null) {
    if (pagamentoEmAndamentoRef.current) return;

    pagamentoEmAndamentoRef.current = true;
    setPagamentoEmAndamento(true);
    const comprovanteParaEnvio = comprovante ?? comprovanteSelecionado;
    const novosAlunos = alunos.map((aluno) => {
      if (aluno.id === idAluno) {
        return {
          ...aluno,
          statusPagamento: "Aguardando",
          comprovantePagamento: comprovanteParaEnvio,
          dataEnvioComprovante: new Date().toLocaleDateString(),
        };
      }
      return aluno;
    });

    const alunoAtualizado = novosAlunos.find((aluno) => aluno.id === idAluno);
    if (!alunoAtualizado) {
      pagamentoEmAndamentoRef.current = false;
      setPagamentoEmAndamento(false);
      return;
    }

    if (usuarioOnlineLogado) {
      try {
        const pagamentosOnlineAtuais = await listarPagamentosOnline();
        const pagamentoAguardando = obterPagamentoAguardandoAberto(
          idAluno,
          pagamentosOnlineAtuais
        );
        const pagamentoPagoNoCiclo = pagamentosOnlineAtuais.find(
          (pagamento) =>
            String(pagamento.aluno_id) === String(idAluno) &&
            pagamento.status === "Pago" &&
            pagamentoNoCicloAtual(pagamento)
        );

        if (!pagamentoAguardando && pagamentoPagoNoCiclo) {
          await carregarDadosOnlineNoEstado();
          abrirModalMensagem({
            tipo: "informacao",
            titulo: "Pagamento já confirmado",
            mensagem: "Este pagamento já está confirmado neste ciclo.",
          });
          return;
        }

        await Promise.all([
          salvarAlunoOnline(alunoAtualizado),
          salvarPagamentoOnline({
            ...(pagamentoAguardando?.id ? { id: pagamentoAguardando.id } : {}),
            aluno_id: idAluno,
            valor: Number(alunoAtualizado.mensalidade || 0),
            status: "Aguardando",
            data_pagamento:
              pagamentoAguardando?.data_pagamento ||
              new Date().toISOString().slice(0, 10),
            comprovante_url:
              comprovanteParaEnvio ||
              pagamentoAguardando?.comprovante_url ||
              null,
          }),
        ]);
        setAlunos(novosAlunos);
        await carregarDadosOnlineNoEstado();
      } catch (error) {
        console.error("Erro ao enviar pagamento online.", error);
        await carregarDadosOnlineNoEstado().catch((erroSincronizacao) => {
          console.error("Erro ao restaurar dados apos falha no envio de pagamento.", erroSincronizacao);
        });
        abrirModalMensagem({
          tipo: "erro",
          titulo: "Erro ao enviar pagamento",
          mensagem: `Nao foi possivel enviar o pagamento ao banco online.\n\nErro: ${error.message || "erro desconhecido"}`,
        });
        return;
      } finally {
        pagamentoEmAndamentoRef.current = false;
        setPagamentoEmAndamento(false);
      }
    } else {
      setAlunos(novosAlunos);
      pagamentoEmAndamentoRef.current = false;
      setPagamentoEmAndamento(false);
    }

    setNomeComprovanteSelecionado("");
    setComprovanteSelecionado(null);
    abrirModalMensagem({
      tipo: "sucesso",
      titulo: "Pagamento enviado",
      mensagem: "Pagamento enviado para analise.",
    });
  }

  async function rejeitarPagamento(idAluno) {
    const novosAlunos = alunos.map((aluno) => {
      if (aluno.id === idAluno) {
        return {
          ...aluno,
          statusPagamento: "Pendente",
          comprovantePagamento: null,
          dataEnvioComprovante: "",
        };
      }
      return aluno;
    });

    const alunoAtualizado = novosAlunos.find((aluno) => aluno.id === idAluno);
    if (!alunoAtualizado) return;

    if (diretorOnlineLogado) {
      try {
        await Promise.all([
          salvarAlunoOnline(alunoAtualizado),
          salvarPagamentoOnline({
            aluno_id: idAluno,
            valor: Number(alunoAtualizado.mensalidade || 0),
            status: "Rejeitado",
            data_pagamento: new Date().toISOString().slice(0, 10),
          }),
        ]);
        setAlunos(novosAlunos);
        await carregarDadosOnlineNoEstado();
      } catch (error) {
        console.error("Erro ao rejeitar pagamento online.", error);
        await carregarDadosOnlineNoEstado().catch((erroSincronizacao) => {
          console.error("Erro ao restaurar dados apos falha na rejeicao de pagamento.", erroSincronizacao);
        });
        alert(`Nao foi possivel rejeitar o pagamento no banco online.\n\nErro: ${error.message || "erro desconhecido"}`);
        return;
      }
    } else {
      setAlunos(novosAlunos);
    }

    alert("Comprovante rejeitado.");
  }

  function gerarReciboPDF(aluno) {
    const doc = new jsPDF();

    const dataAtual = new Date().toLocaleDateString();
    const valorPago = calcularValorComJuros(aluno);

    doc.setFontSize(18);
    doc.text("RECIBO DE PAGAMENTO", 20, 20);

    doc.setFontSize(12);
    doc.text("Ariramba Jiu-Jitsu School", 20, 35);
    doc.text(`Aluno: ${aluno.nome}`, 20, 50);
    doc.text(`Data do pagamento: ${dataAtual}`, 20, 60);
    doc.text(`Valor pago: ${formatarMoeda(valorPago)}`, 20, 70);
    doc.text("Status: Pago", 20, 80);

    doc.text(
      "Declaramos que o pagamento da mensalidade foi recebido com sucesso.",
      20,
      100
    );

    doc.text("Assinatura: _______________________________", 20, 130);

    doc.save(`recibo-${aluno.nome}.pdf`);
  }

  function gerarRelatorioFinanceiroPDF() {
    const doc = new jsPDF();
    let y = 20;

    function escreverLinha(texto, x = 20, incremento = 8) {
      if (y > 280) {
        doc.addPage();
        y = 20;
      }

      doc.text(texto, x, y);
      y += incremento;
    }

    doc.setFontSize(18);
    escreverLinha("RELATORIO FINANCEIRO", 20, 10);

    doc.setFontSize(12);
    escreverLinha("Ariramba Jiu-Jitsu School");
    escreverLinha(`Emitido em: ${new Date().toLocaleString()}`, 20, 12);

    doc.setFontSize(14);
    escreverLinha("Resumo geral", 20, 10);
    doc.setFontSize(11);
    escreverLinha(`Total de alunos: ${alunos.length}`);
    escreverLinha(`Turma Kids: ${totalKids}`);
    escreverLinha(`Turma Adultos: ${totalAdultos}`);
    escreverLinha(`Presencas hoje: ${presencasHoje}`);
    escreverLinha(`Pagos: ${totalPagos}`);
    escreverLinha(`Pendentes: ${totalPendentes}`);
    escreverLinha(`Vencidos: ${totalVencidos}`);
    escreverLinha(`Aguardando confirmacao: ${pagamentosAguardando.length}`, 20, 12);

    doc.setFontSize(14);
    escreverLinha("Financeiro", 20, 10);
    doc.setFontSize(11);
    escreverLinha(`Total arrecadado: ${formatarMoeda(totalArrecadado)}`);
    escreverLinha(`Total a receber: ${formatarMoeda(totalPendenteReceber)}`);
    escreverLinha(`Previsao do mes: ${formatarMoeda(valorEsperadoMes)}`, 20, 12);

    doc.setFontSize(14);
    escreverLinha("Resumo por turma", 20, 10);
    doc.setFontSize(10);
    resumoTurmas.forEach((resumo) => {
      escreverLinha(
        `${resumo.turma}: ${resumo.alunos} aluno(s) | ${resumo.presencasHoje} presenca(s) hoje | ${resumo.pagos} pago(s) | ${resumo.pendentes} pendente(s) | ${resumo.vencidos} vencido(s) | receber ${formatarMoeda(resumo.receber)}`
      );
    });

    y += 4;

    doc.setFontSize(14);
    escreverLinha("Alunos que precisam de atencao", 20, 10);
    doc.setFontSize(10);

    if (alunosAtencaoRelatorio.length === 0) {
      escreverLinha("Nenhum aluno em atraso ou aguardando confirmacao.");
    } else {
      alunosAtencaoRelatorio.forEach((aluno) => {
        escreverLinha(
          `${aluno.nome} | ${aluno.turma || "Adultos"} | ${verificarVencimento(aluno)} | ${formatarMoeda(calcularValorComJuros(aluno))} | cobranca ${formatarDataCobranca(aluno)}`
        );
      });
    }

    y += 4;

    doc.setFontSize(14);
    escreverLinha("Todos os alunos", 20, 10);
    doc.setFontSize(9);
    alunos.forEach((aluno) => {
      escreverLinha(
        `${aluno.nome} | ${aluno.turma || "Adultos"} | ${verificarVencimento(aluno)} | ${formatarMoeda(calcularValorComJuros(aluno))} | presencas ${aluno.presencas.length}`,
        20,
        6
      );
    });

    doc.save("relatorio-financeiro-ariramba.pdf");
  }

  async function baixarCarteirinhaPDF(aluno) {
    if (!aluno) {
      alert("Aluno nao encontrado.");
      return;
    }

    let alunoParaPDF = aluno;

    if (!alunoParaPDF.foto && !alunoParaPDF.fotoUrl && supabaseConfigurado && idAlunoOnlineValido(alunoParaPDF.id)) {
      try {
        const fotoOnline = await obterFotoAlunoOnline(alunoParaPDF.id);
        alunoParaPDF = {
          ...alunoParaPDF,
          foto: fotoOnline,
          fotoUrl: fotoOnline,
        };
      } catch (error) {
        console.error("Erro ao carregar foto do aluno para PDF.", error);
      }
    }

    const qrCanvas = document.querySelector("#qrCarteirinhaAluno canvas");
    const qrImagem = qrCanvas?.toDataURL("image/png");
    const status = verificarVencimento(alunoParaPDF) === "Pago"
      ? "Ativo"
      : verificarVencimento(alunoParaPDF) === "Vencido"
        ? "Vencido"
        : "Pendente";

    const doc = new jsPDF({
      orientation: "landscape",
      unit: "mm",
      format: [86, 54],
    });

    doc.setFillColor(15, 23, 42);
    doc.rect(0, 0, 86, 54, "F");
    doc.setDrawColor(245, 158, 11);
    doc.setLineWidth(0.8);
    doc.roundedRect(3, 3, 80, 48, 3, 3, "S");

    doc.setTextColor(245, 158, 11);
    doc.setFontSize(8.5);
    doc.text("ARIRAMBA JIU-JITSU SCHOOL", 43, 8.2, { align: "center" });

    const fotoCarteira = alunoParaPDF.foto || alunoParaPDF.fotoUrl;

    if (fotoCarteira) {
      try {
        const fotoCarteirinha = await prepararFotoCarteirinha(fotoCarteira);
        doc.addImage(fotoCarteirinha, "JPEG", 6.5, 15, 21, 21);
      } catch (error) {
        console.error("Erro ao adicionar foto na carteirinha.", error);
        doc.setDrawColor(148, 163, 184);
        doc.roundedRect(6.5, 15, 21, 21, 2, 2, "S");
        doc.setTextColor(148, 163, 184);
        doc.setFontSize(5);
        doc.text("Foto", 17, 26, { align: "center" });
      }
    } else {
      doc.setDrawColor(148, 163, 184);
      doc.roundedRect(6.5, 15, 21, 21, 2, 2, "S");
      doc.setTextColor(148, 163, 184);
      doc.setFontSize(5);
      doc.text("Sem foto", 17, 26, { align: "center" });
    }

    doc.setTextColor(255, 255, 255);
    doc.setFontSize(5);

    const larguraTextoCarteirinha = 31;
    const nomeCarteirinha = doc
      .splitTextToSize(`Aluno: ${alunoParaPDF.nome || usuarioLogado?.nome || ""}`, larguraTextoCarteirinha)
      .slice(0, 2);
    let posicaoTextoCarteirinha = 15.5;

    doc.text(nomeCarteirinha, 30, posicaoTextoCarteirinha);
    posicaoTextoCarteirinha += nomeCarteirinha.length * 3.2 + 1;

    [
      "Academia: Ariramba Jiu-Jitsu School",
      `Faixa: ${alunoParaPDF.faixa || "Nao informado"}`,
      `Grau: ${alunoParaPDF.grau || "Nao informado"}`,
      `Turma: ${alunoParaPDF.turma || "Adultos"}`,
      `Status: ${status}`,
      `Cobranca: ${formatarDataCobranca(alunoParaPDF)}`,
    ].forEach((linha) => {
      const linhasCampo = doc
        .splitTextToSize(linha, larguraTextoCarteirinha)
        .slice(0, linha.startsWith("Academia") ? 2 : 1);

      doc.text(linhasCampo, 30, posicaoTextoCarteirinha);
      posicaoTextoCarteirinha += linhasCampo.length * 3.2 + 1;
    });

    if (qrImagem) {
      doc.addImage(qrImagem, "PNG", 65, 15, 15, 15);
      doc.setFontSize(5.4);
      doc.text("QR de presenca", 72.5, 34, { align: "center", maxWidth: 18 });
    }

    doc.save(`carteirinha-${normalizarNomeArquivo(alunoParaPDF.nome)}.pdf`);
  }

  async function baixarCarteirinhaPNG(aluno) {
    if (!aluno) {
      alert("Aluno nao encontrado.");
      return;
    }

    try {
      const escala = 3;
      const largura = 650;
      const altura = 400;
      const canvas = document.createElement("canvas");
      const contexto = canvas.getContext("2d");
      const qrCanvas = document.querySelector(".areaCarteirinha .qrcodeFake canvas");
      const fotoCarteira = aluno.foto || aluno.fotoUrl;
      const nomeArquivo = `carteirinha-${normalizarNomeArquivo(aluno.nome)}.png`;

      canvas.width = largura * escala;
      canvas.height = altura * escala;
      contexto.scale(escala, escala);
      contexto.imageSmoothingEnabled = true;
      contexto.imageSmoothingQuality = "high";

      function retanguloArredondado(x, y, w, h, r) {
        contexto.beginPath();
        contexto.moveTo(x + r, y);
        contexto.lineTo(x + w - r, y);
        contexto.quadraticCurveTo(x + w, y, x + w, y + r);
        contexto.lineTo(x + w, y + h - r);
        contexto.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        contexto.lineTo(x + r, y + h);
        contexto.quadraticCurveTo(x, y + h, x, y + h - r);
        contexto.lineTo(x, y + r);
        contexto.quadraticCurveTo(x, y, x + r, y);
        contexto.closePath();
      }

      function desenharImagemCobrindo(imagem, x, y, w, h) {
        const escalaImagem = Math.max(w / imagem.width, h / imagem.height);
        const larguraImagem = imagem.width * escalaImagem;
        const alturaImagem = imagem.height * escalaImagem;
        const origemX = x + (w - larguraImagem) / 2;
        const origemY = y + (h - alturaImagem) / 2;

        contexto.drawImage(imagem, origemX, origemY, larguraImagem, alturaImagem);
      }

      function textoQuebrado(texto, x, y, larguraMaxima, alturaLinha, maxLinhas = 2) {
        const palavras = String(texto || "").split(/\s+/).filter(Boolean);
        const linhas = [];
        let linhaAtual = "";

        palavras.forEach((palavra) => {
          const teste = linhaAtual ? `${linhaAtual} ${palavra}` : palavra;

          if (contexto.measureText(teste).width <= larguraMaxima || !linhaAtual) {
            linhaAtual = teste;
            return;
          }

          linhas.push(linhaAtual);
          linhaAtual = palavra;
        });

        if (linhaAtual) linhas.push(linhaAtual);

        linhas.slice(0, maxLinhas).forEach((linha, indice) => {
          contexto.fillText(linha, x, y + indice * alturaLinha);
        });

        return y + Math.min(linhas.length, maxLinhas) * alturaLinha;
      }

      retanguloArredondado(0, 0, largura, altura, 26);
      contexto.save();
      contexto.clip();
      const fundo = contexto.createLinearGradient(0, 0, largura, altura);
      fundo.addColorStop(0, "#f8fafc");
      fundo.addColorStop(0.22, "#ffffff");
      fundo.addColorStop(0.23, "#111827");
      fundo.addColorStop(1, "#05070a");
      contexto.fillStyle = fundo;
      contexto.fillRect(0, 0, largura, altura);
      contexto.restore();

      contexto.strokeStyle = "#f59e0b";
      contexto.lineWidth = 3;
      retanguloArredondado(1.5, 1.5, largura - 3, altura - 3, 26);
      contexto.stroke();

      contexto.fillStyle = "#f8fafc";
      contexto.font = "900 42px Arial, sans-serif";
      contexto.fillText("ARIRAMBA", 245, 62);
      contexto.fillStyle = "#f59e0b";
      contexto.font = "900 19px Arial, sans-serif";
      contexto.fillText("JIU-JITSU SCHOOL", 250, 105);

      const imagemLogo = await carregarImagem(logo);
      retanguloArredondado(78, 28, 100, 100, 12);
      contexto.fillStyle = "#ffffff";
      contexto.fill();
      contexto.drawImage(imagemLogo, 86, 36, 84, 84);

      if (fotoCarteira) {
        try {
          const imagemFoto = await carregarImagem(fotoCarteira);
          retanguloArredondado(38, 145, 180, 180, 18);
          contexto.save();
          contexto.clip();
          desenharImagemCobrindo(imagemFoto, 38, 145, 180, 180);
          contexto.restore();
          contexto.strokeStyle = "#f59e0b";
          contexto.lineWidth = 4;
          retanguloArredondado(38, 145, 180, 180, 18);
          contexto.stroke();
        } catch (error) {
          console.error("Erro ao adicionar foto na carteirinha PNG.", error);
        }
      }

      contexto.fillStyle = "#ffffff";
      contexto.font = "700 14px Arial, sans-serif";
      contexto.textAlign = "center";
      retanguloArredondado(53, 365, 150, 18, 9);
      contexto.save();
      contexto.clip();
      contexto.fillStyle = corDaFaixa(aluno.faixa);
      contexto.fillRect(53, 365, 105, 18);
      contexto.fillStyle = String(aluno.faixa || "").toLowerCase() === "preta" ? "#dc2626" : "#111827";
      contexto.fillRect(158, 365, 45, 18);

      if (aluno.grau) {
        contexto.fillStyle = "#ffffff";
        [168, 181, 194].forEach((x) => contexto.fillRect(x, 365, 4, 18));
      }

      contexto.restore();
      contexto.strokeStyle = "rgba(255, 255, 255, 0.25)";
      contexto.lineWidth = 2;
      retanguloArredondado(53, 365, 150, 18, 9);
      contexto.stroke();

      contexto.textAlign = "left";
      contexto.fillStyle = "#ffffff";
      contexto.font = "900 25px Arial, sans-serif";
      let yTexto = textoQuebrado(String(aluno.nome || "").toUpperCase(), 245, 155, 280, 29, 2) + 8;

      contexto.font = "400 17px Arial, sans-serif";
      [
        `Faixa: ${aluno.faixa || "Nao informada"}`,
        `Turma: ${aluno.turma || "Adultos"}`,
        ...(aluno.grau ? [`Grau: ${aluno.grau}`] : []),
        `Nascimento: ${formatarData(aluno.dataNascimento)}`,
        `Carteira emitida: ${new Date().getFullYear()}`,
        "Renovação: Próxima troca de faixa",
        `ID: ${aluno.id}`,
      ].forEach((linha) => {
        yTexto = textoQuebrado(linha, 245, yTexto, 300, 22, 2) + 2;
      });

      retanguloArredondado(515, 260, 105, 105, 12);
      contexto.fillStyle = "#ffffff";
      contexto.fill();

      if (qrCanvas) {
        contexto.drawImage(qrCanvas, 528, 273, 80, 80);
      }

      canvas.toBlob((blob) => {
        if (!blob) {
          const linkFallback = document.createElement("a");
          linkFallback.href = canvas.toDataURL("image/png");
          linkFallback.download = nomeArquivo;
          linkFallback.rel = "noopener";
          linkFallback.click();
          return;
        }

        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = nomeArquivo;
        link.rel = "noopener";
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }, "image/png");
    } catch (error) {
      console.error("Erro ao baixar carteirinha em PNG.", error);
      alert("Nao foi possivel gerar a imagem da carteirinha.");
    }
  }

  async function abrirCarteirinha(aluno) {
    if (!aluno) return;

    setAlunoCarteirinha(aluno);

    if (
      !supabaseConfigurado ||
      aluno.foto ||
      aluno.fotoUrl ||
      !idAlunoOnlineValido(aluno.id)
    ) {
      return;
    }

    try {
      const fotoOnline = await obterFotoAlunoOnline(aluno.id);

      if (!fotoOnline) return;

      const alunoComFoto = {
        ...aluno,
        foto: fotoOnline,
        fotoUrl: fotoOnline,
      };

      setAlunoCarteirinha(alunoComFoto);
      setAlunos((alunosAtuais) =>
        alunosAtuais.map((alunoAtual) =>
          String(alunoAtual.id) === String(aluno.id)
            ? { ...alunoAtual, foto: fotoOnline, fotoUrl: fotoOnline }
            : alunoAtual
        )
      );
    } catch (error) {
      console.error("Erro ao carregar foto do aluno para a carteirinha.", error);
    }
  }

  async function registrarPresenca(idAluno) {
    const alunoEncontrado = alunos.find(
      (aluno) => String(aluno.id) === String(idAluno)
    );

    if (alunoEncontrado) {
      if (bloquearPresencaSeMensalidadeVencida(alunoEncontrado)) {
        return;
      }

      avisarPendenciaFinanceiraNaPresenca(alunoEncontrado);

      const hoje = new Date().toLocaleDateString();
      const jaRegistrou = (alunoEncontrado.presencas || []).some(
        (presenca) => presenca.data === hoje
      );

      if (jaRegistrou) {
        alert("Aluno já registrou presença hoje.");
        return;
      }

      const novaPresenca = {
        alunoId: alunoEncontrado.id,
        nome: alunoEncontrado.nome,
        foto: alunoEncontrado.foto,
        data: new Date().toLocaleDateString(),
        hora: new Date().toLocaleTimeString(),
      };

      const novosAlunos = alunos.map((aluno) => {
        if (String(aluno.id) === String(idAluno)) {
          return {
            ...aluno,
            presencas: [
              ...(aluno.presencas || []),
              {
                data: novaPresenca.data,
                hora: novaPresenca.hora,
              },
            ],
          };
        }

        return aluno;
      });

      if (usuarioOnlineLogado) {
        try {
          await registrarPresencaOnline(novaPresenca);
        } catch (error) {
          console.error("Erro ao registrar presença online.", error);
          alert(`Não foi possível enviar a presença ao banco online.\n\nErro: ${error.message}`);
          return;
        }
      }

      setAlunos(novosAlunos);
      setPresencas((prev) => [...prev, novaPresenca]);

      adicionarAviso(`${alunoEncontrado.nome} registrou presença`);
      alert("Presença registrada.");
    }

  }

  async function lerQRCodePorArquivo(arquivo) {
    if (!arquivo) return;

    setNomeArquivoScanner(arquivo.name);
    setStatusScanner("Lendo QR da imagem...");

    const leitorArquivo = new Html5Qrcode("readerArquivo");

    try {
      const resultado = await leitorArquivo.scanFile(arquivo, false);
      setStatusScanner("QR lido pela imagem. Processando...");
      await registrarPresencaPorQRCode(resultado);
    } catch (error) {
      console.error("Erro ao ler QR pela imagem.", error);
      setStatusScanner("Nao foi possivel ler o QR desta imagem.");
      alert("Nao consegui ler o QR desta imagem. Tire uma foto mais perto, bem iluminada, e tente novamente.");
    } finally {
      try {
        leitorArquivo.clear();
      } catch {
        // Leitor de arquivo ja estava limpo.
      }
    }
  }

  async function removerAluno(idAluno) {
    const confirmar = confirm("Deseja remover este aluno?");

    if (!confirmar) return;

    const alunoRemovido = alunos.find((aluno) => aluno.id === idAluno);

    if (diretorOnlineLogado) {
      try {
        await removerAlunoOnline(idAluno);
      } catch (error) {
        console.error("Erro ao remover aluno online.", error);
        alert(`Nao foi possivel remover o aluno do banco online.\n\nErro: ${error.message || "erro desconhecido"}`);
        return;
      }
    }

    if (diretorOnlineLogado) {
      try {
        await removerUsuarioSistemaOnlinePorAluno(idAluno);
      } catch (error) {
        console.error("Erro ao remover usuário online do aluno.", error);
      }
    }

    const novosAlunos = alunos.filter(
      (aluno) => aluno.id !== idAluno
    );

    setAlunos(novosAlunos);
    setUsuarios((prev) => prev.filter((usuario) => usuario.alunoId !== idAluno));
    setPresencas((prev) =>
      prev.filter(
        (presenca) =>
          presenca.alunoId !== idAluno &&
          (!alunoRemovido || presenca.nome !== alunoRemovido.nome)
      )
    );

    alert("Aluno removido com sucesso 🗑️");
  }

  function exportarBackup() {
    const backup = {
      app: APP_NAME,
      versao: 1,
      geradoEm: new Date().toISOString(),
      alunos,
      presencas,
      avisos,
      usuarios,
    };

    const arquivo = new Blob([JSON.stringify(backup, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(arquivo);
    const link = document.createElement("a");

    link.href = url;
    link.download = `backup-ariramba-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();

    URL.revokeObjectURL(url);
  }

  function importarBackup(evento) {
    const arquivo = evento.target.files?.[0];

    if (!arquivo) return;

    const confirmar = confirm(
      "Restaurar este backup vai substituir os dados atuais deste navegador. Deseja continuar?"
    );

    if (!confirmar) {
      evento.target.value = "";
      return;
    }

    const leitor = new FileReader();

    leitor.onload = () => {
      try {
        const backup = JSON.parse(leitor.result);

        if (!Array.isArray(backup.alunos) || !Array.isArray(backup.usuarios)) {
          alert("Arquivo de backup inválido.");
          return;
        }

        setAlunos(backup.alunos.map(normalizarAluno));
        setPresencas(Array.isArray(backup.presencas) ? backup.presencas : []);
        setAvisos(Array.isArray(backup.avisos) ? backup.avisos : []);
        setUsuarios(backup.usuarios);
        setErroArmazenamento("");

        alert("Backup restaurado com sucesso.");
      } catch (error) {
        console.error("Erro ao importar backup.", error);
        alert("Não foi possível ler este arquivo de backup.");
      } finally {
        evento.target.value = "";
      }
    };

    leitor.readAsText(arquivo);
  }

  function entrarUsuarioLocal(usuarioEncontrado) {
    setUsuarioLogado(usuarioEncontrado);
    setTipoUsuario(usuarioEncontrado.cargo);

    if (usuarioEncontrado.cargo === "aluno") {
      setTela("portalAluno");

      if (usuarioEncontrado.senha === "1234") {
        setNovaSenha("");
        setConfirmarSenha("");
        setModoEditarPerfil(true);
        avisarPrimeiroAcesso();
      }
    } else if (usuarioEncontrado.cargo === "professor") {
      setFoto(usuarioEncontrado.foto || usuarioEncontrado.fotoUrl || "");
      setTela("portalProfessor");

      if (usuarioEncontrado.senha === "1234") {
        setNovaSenha("");
        setConfirmarSenha("");
        setModoEditarPerfil(true);
        avisarPrimeiroAcesso();
      }
    } else {
      setTela("dashboard");
    }
  }

  function promoverSessaoOnlineSistema(usuarioDigitado, senhaDigitada) {
    if (!supabaseConfigurado) return;

    limitarTempo(
      buscarUsuarioSistemaOnline(usuarioDigitado),
      2500,
      "Consulta online demorou demais."
    )
      .then((usuarioOnlineSistema) => {
        if (usuarioOnlineSistema?.senha?.trim() !== senhaDigitada) return;

        setUsuarios((usuariosAtuais) => {
          const jaExiste = usuariosAtuais.some(
            (usuarioAtual) =>
              usuarioAtual.usuario.trim().toLowerCase() ===
              usuarioOnlineSistema.usuario.trim().toLowerCase()
          );

          return jaExiste ? usuariosAtuais : [...usuariosAtuais, usuarioOnlineSistema];
        });

        if (usuarioOnlineSistema.cargo === "professor") {
          setFoto(usuarioOnlineSistema.foto || usuarioOnlineSistema.fotoUrl || "");
        }

        setUsuarioLogado(usuarioOnlineSistema);
        setTipoUsuario(usuarioOnlineSistema.cargo);
        setErroArmazenamento("");
      })
      .catch((error) => {
        console.error("Erro ao confirmar usuário online.", error);
        setErroArmazenamento(
          "Entrou rápido no modo local. A confirmação online ainda não respondeu; tente enviar ao banco novamente em alguns segundos."
        );
      });
  }

  async function fazerLogin() {
    if (loginEmAndamento) return;

    const usuarioDigitado = usuario.trim();
    const senhaDigitada = senha.trim();

    if (!usuarioDigitado || !senhaDigitada) {
      abrirModalMensagem({
        tipo: "aviso",
        titulo: "Campos obrigatórios",
        mensagem: "Digite usuário e senha.",
      });
      return;
    }

    setLoginEmAndamento(true);

    const usuarioLocal = usuarios.find(
      (u) =>
        String(u?.usuario || "").trim().toLowerCase() === usuarioDigitado.toLowerCase() &&
        String(u?.senha || "").trim() === senhaDigitada
    );

    if (usuarioLocal) {
      entrarUsuarioLocal(usuarioLocal);
      promoverSessaoOnlineSistema(usuarioDigitado, senhaDigitada);
      setLoginEmAndamento(false);
      return;
    }

    if (supabaseConfigurado && !usuarioDigitado.includes("@")) {
      try {
        const usuarioOnlineSistema = await limitarTempo(
          buscarUsuarioSistemaOnline(usuarioDigitado),
          1500,
          "Consulta online demorou demais."
        );

        if (usuarioOnlineSistema?.senha?.trim() === senhaDigitada) {
          setUsuarios((usuariosAtuais) => {
            const jaExiste = usuariosAtuais.some(
              (usuarioAtual) =>
                usuarioAtual.usuario.trim().toLowerCase() ===
                usuarioOnlineSistema.usuario.trim().toLowerCase()
            );

            return jaExiste ? usuariosAtuais : [...usuariosAtuais, usuarioOnlineSistema];
          });

          entrarUsuarioLocal(usuarioOnlineSistema);
          setLoginEmAndamento(false);
          return;
        }
      } catch (error) {
        console.error("Erro ao consultar usuário online.", error);
      }
    }

    if (supabaseConfigurado && usuarioDigitado.includes("@")) {
      try {
        const loginOnline = await limitarTempo(
          entrarComEmailSenha(usuarioDigitado, senhaDigitada),
          15000,
          "Login online demorou demais."
        );

        const perfil = await limitarTempo(
          obterPerfilSupabase(),
          15000,
          "Perfil online demorou demais."
        );

        if (!perfil?.cargo || !perfil?.academia_id) {
          await sairDoSupabase().catch((error) => {
            console.error("Erro ao encerrar sessao sem perfil online.", error);
          });
          abrirModalMensagem({
            tipo: "erro",
            titulo: "Perfil não autorizado",
            mensagem: "Login autenticado, mas este usuário ainda não possui perfil autorizado no banco online.",
          });
          setLoginEmAndamento(false);
          return;
        }

        const usuarioOnline = {
          id: perfil.id || loginOnline?.user?.id || usuarioDigitado,
          usuario: usuarioDigitado,
          cargo: perfil.cargo,
          nome: perfil.nome || usuarioDigitado,
          alunoId: perfil.aluno_id,
          academiaId: perfil.academia_id,
          origem: "supabase",
        };

        setUsuarios((usuariosAtuais) => {
          const jaExiste = usuariosAtuais.some(
            (usuarioAtual) =>
              usuarioAtual.usuario.trim().toLowerCase() === usuarioDigitado.toLowerCase()
          );

          return jaExiste ? usuariosAtuais : [...usuariosAtuais, usuarioOnline];
        });
        setUsuarioLogado(usuarioOnline);
        setTipoUsuario(perfil.cargo);

        if (perfil.cargo === "aluno") {
          setTela("portalAluno");
        } else if (perfil.cargo === "professor") {
          setTela("portalProfessor");
        } else {
          setTela("dashboard");
        }

        setLoginEmAndamento(false);
        return;
      } catch (error) {
        console.error("Erro no login online.", error);
        limitarTempo(
          sairDoSupabase(),
          3000,
          "Logout apos falha no login demorou demais."
        ).catch((erroLogout) => {
          console.error("Erro ao limpar sessao apos falha no login.", erroLogout);
        });
        abrirModalMensagem({
          tipo: "erro",
          titulo: "Erro no login",
          mensagem: `Não foi possível entrar pelo Supabase.\n\nDetalhe: ${error.message || "erro desconhecido"
            }`,
        });
        setLoginEmAndamento(false);
        return;
      }
    }
    abrirModalMensagem({
      tipo: "erro",
      titulo: "Login inválido",
      mensagem: "Usuário ou senha inválidos.",
    });
    setLoginEmAndamento(false);
  }

  async function sairDoSistema() {
    if (supabaseConfigurado) {
      await sairDoSupabase().catch((error) => {
        console.error("Erro ao sair do Supabase.", error);
      });
    }

    setTela("inicio");
    setUsuario("");
    setSenha("");
    setTipoUsuario("");
    setUsuarioLogado(null);
    setModoEditarPerfil(false);
    setNovaSenha("");
    setConfirmarSenha("");
    setFoto("");
    setMenuAberto(false);
    localStorage.removeItem(STORAGE_KEYS.usuarioLogado);
    localStorage.removeItem("usuario_logado_ariramba");
  }

  async function enviarAlunosParaBancoOnline() {
    if (!supabaseConfigurado) {
      setErroArmazenamento("Supabase ainda não está configurado.");
      return;
    }

    if (!diretorOnlineLogado) {
      setErroArmazenamento(
        "Para enviar alunos ao Supabase, entre com o diretor online. O modo local salva apenas neste navegador."
      );
      return;
    }

    if (alunos.length === 0) {
      setErroArmazenamento("Não há alunos locais para enviar.");
      return;
    }

    const confirmouImportacao = window.confirm(
      "Este botão importa alunos antigos salvos neste navegador para o banco online.\n\nPara usar o sistema do zero, clique em Cancelar.\n\nDeseja importar esses alunos antigos agora?"
    );

    if (!confirmouImportacao) {
      setErroArmazenamento("Importação cancelada. O banco online continua limpo para começar do zero.");
      return;
    }

    try {
      setSincronizacaoOnline("enviando");
      setErroArmazenamento("Enviando alunos para o banco online...");
      const alunosOnline = await migrarAlunosOnline(alunos);
      setAlunos(alunosOnline.map(normalizarAluno));
      setErroArmazenamento("");
      alert(`${alunosOnline.length} aluno(s) enviados para o banco online.`);
    } catch (error) {
      console.error("Erro ao enviar alunos para o Supabase.", error);
      setErroArmazenamento(
        `Não foi possível enviar os alunos para o banco online: ${error.message || "erro desconhecido"}`
      );
    } finally {
      setSincronizacaoOnline("");
    }
  }

  async function carregarAlunosDoBancoOnline() {
    if (!supabaseConfigurado) {
      setErroArmazenamento("Supabase ainda não está configurado.");
      return;
    }

    if (!diretorOnlineLogado) {
      setErroArmazenamento(
        "Para carregar alunos do Supabase, entre com o diretor online."
      );
      return;
    }

    try {
      setSincronizacaoOnline("carregando");
      setErroArmazenamento("Carregando alunos do banco online...");
      const alunosOnlineComDados = await carregarDadosOnlineNoEstado();
      setErroArmazenamento("");
      alert(`${alunosOnlineComDados.length} aluno(s) carregados do banco online.`);
    } catch (error) {
      console.error("Erro ao carregar alunos do Supabase.", error);
      setErroArmazenamento(
        `Não foi possível carregar os alunos do banco online: ${error.message || "erro desconhecido"}`
      );
    } finally {
      setSincronizacaoOnline("");
    }
  }

  function editarAluno(aluno) {
    setAlunoEditando(aluno);
    const usuarioDoAluno = usuarios.find((usuario) => usuario.alunoId === aluno.id);

    setNome(aluno.nome);
    setDataInicio(aluno.dataInicio || "");
    setUsuarioAluno(usuarioDoAluno?.usuario || aluno.usuario || "");
    setSenhaAluno("");
    setTelefone(aluno.telefone);
    setFaixa(aluno.faixa);
    setTurma(aluno.turma || "Adultos");
    setResponsavel(aluno.responsavel);
    setDataNascimento(aluno.dataNascimento);
    setPeso(aluno.peso);
    setGrau(aluno.grau);
    setTipoSanguineo(aluno.tipoSanguineo);
    setSaude(aluno.saude);
    setMedicamentos(aluno.medicamentos);
    setObservacoes(aluno.observacoes);
    setObservacaoFinanceira(aluno.observacaoFinanceira || "");
    contextoFotoTemporariaRef.current = "";
    setFoto(aluno.foto);
    setMensalidade(aluno.mensalidade);
    setVencimento(aluno.vencimento);

    setTela("cadastro");
  }

  async function resetarSenhaAluno(aluno) {
    if (tipoUsuario !== "diretor") return;

    const usuarioLocal = usuarios.find(
      (usuario) => String(usuario.alunoId) === String(aluno.id)
    );
    let usuarioParaAtualizar = usuarioLocal;

    if (diretorOnlineLogado) {
      try {
        usuarioParaAtualizar =
          usuarioParaAtualizar ||
          (await buscarUsuarioSistemaOnlinePorAluno(aluno.id));

        if (!usuarioParaAtualizar) {
          alert("Não foi encontrado acesso online para este aluno.");
          return;
        }

        await salvarUsuarioSistemaOnline({
          ...usuarioParaAtualizar,
          senha: "1234",
          academiaId:
            usuarioParaAtualizar.academiaId ||
            aluno.academiaId ||
            usuarioLogado?.academiaId ||
            "",
        });
      } catch (error) {
        console.error("Erro ao resetar senha online do aluno.", error);
        alert(`Não foi possível resetar a senha no banco online.\n\nErro: ${error.message || "erro desconhecido"}`);
        return;
      }
    }

    if (!usuarioParaAtualizar) {
      alert("Não foi encontrado acesso para este aluno.");
      return;
    }

    setUsuarios((usuariosAtuais) => {
      const jaExiste = usuariosAtuais.some(
        (usuario) => String(usuario.alunoId) === String(aluno.id)
      );

      if (!jaExiste) {
        return [
          ...usuariosAtuais,
          {
            ...usuarioParaAtualizar,
            senha: "1234",
          },
        ];
      }

      return usuariosAtuais.map((usuario) =>
        String(usuario.alunoId) === String(aluno.id)
          ? { ...usuario, senha: "1234" }
          : usuario
      );
    });

    alert("Senha resetada para 1234.");
  }

  const alunosFiltrados = alunos.filter((aluno) => {
    const nomeEncontrado = aluno.nome.toLowerCase().includes(busca.toLowerCase());
    const turmaEncontrada =
      filtroTurma === "Todas" || (aluno.turma || "Adultos") === filtroTurma;

    return nomeEncontrado && turmaEncontrada;
  });

  const totalKids = alunos.filter((aluno) => (aluno.turma || "Adultos") === "Kids").length;
  const totalAdultos = alunos.filter((aluno) => (aluno.turma || "Adultos") === "Adultos").length;

  const alunoDoPortal = alunos.find((aluno) => {
    if (!usuarioLogado) return false;

    const mesmoId =
      usuarioLogado.alunoId &&
      String(aluno.id) === String(usuarioLogado.alunoId);
    const mesmoUsuario =
      aluno.usuario &&
      usuarioLogado.usuario &&
      aluno.usuario.trim().toLowerCase() === usuarioLogado.usuario.trim().toLowerCase();
    const mesmoNome =
      aluno.nome &&
      usuarioLogado.nome &&
      aluno.nome.trim().toLowerCase() === usuarioLogado.nome.trim().toLowerCase();

    return mesmoId || mesmoUsuario || mesmoNome;
  });

  useEffect(() => {
    if (tela !== "portalProfessor" || usuarioLogado?.cargo !== "professor") {
      return;
    }

    setFoto((fotoAtual) => {
      const contextoProfessorAtual = `portal-professor:${usuarioLogado?.id || usuarioLogado?.usuario || ""}`;
      const fotoTemporariaDoContextoAtual =
        String(fotoAtual || "").startsWith("data:image/") &&
        contextoFotoTemporariaRef.current === contextoProfessorAtual;

      if (modoEditarPerfil && fotoTemporariaDoContextoAtual) {
        return fotoAtual;
      }

      contextoFotoTemporariaRef.current = "";
      return usuarioLogado?.foto || usuarioLogado?.fotoUrl || "";
    });
  }, [tela, usuarioLogado, modoEditarPerfil]);

  useEffect(() => {
    if (tela === "portalAluno" && alunoDoPortal) {
      const usuarioDoAluno = usuarios.find(
        (usuario) =>
          String(usuario.alunoId) === String(alunoDoPortal.id) ||
          usuario.usuario?.trim().toLowerCase() === usuarioLogado?.usuario?.trim().toLowerCase()
      );

      setUsuarioAluno(usuarioDoAluno?.usuario || usuarioLogado?.usuario || alunoDoPortal.usuario || "");
      setTelefone(alunoDoPortal.telefone || "");
      setResponsavel(alunoDoPortal.responsavel || "");
      setTipoSanguineo(alunoDoPortal.tipoSanguineo || "");
      setSaude(alunoDoPortal.saude || "");
      setMedicamentos(alunoDoPortal.medicamentos || "");
      setObservacoes(alunoDoPortal.observacoes || "");
      setFoto((fotoAtual) => {
        const contextoAlunoAtual = `portal-aluno:${alunoDoPortal?.id || usuarioLogado?.alunoId || usuarioLogado?.usuario || ""}`;
        const fotoTemporariaDoContextoAtual =
          String(fotoAtual || "").startsWith("data:image/") &&
          contextoFotoTemporariaRef.current === contextoAlunoAtual;

        if (modoEditarPerfil && fotoTemporariaDoContextoAtual) {
          return fotoAtual;
        }

        contextoFotoTemporariaRef.current = "";
        return alunoDoPortal.foto || alunoDoPortal.fotoUrl || "";
      });
    }
  }, [tela, alunoDoPortal, usuarios, usuarioLogado, modoEditarPerfil]);

  useEffect(() => {
    if (
      tela !== "portalAluno" ||
      alunoDoPortal ||
      !supabaseConfigurado ||
      !usuarioLogado?.alunoId ||
      !idAlunoOnlineValido(usuarioLogado.alunoId)
    ) {
      return;
    }

    let ativo = true;

    obterAlunoOnline(usuarioLogado.alunoId)
      .then((alunoOnline) => {
        if (!ativo) return;

        const alunoNormalizado = normalizarAluno(alunoOnline);
        setAlunos((alunosAtuais) => {
          const jaExiste = alunosAtuais.some(
            (alunoAtual) => String(alunoAtual.id) === String(alunoNormalizado.id)
          );

          return jaExiste
            ? alunosAtuais.map((alunoAtual) =>
              String(alunoAtual.id) === String(alunoNormalizado.id)
                ? alunoNormalizado
                : alunoAtual
            )
            : [...alunosAtuais, alunoNormalizado];
        });
      })
      .catch((error) => {
        console.error("Erro ao recuperar aluno do portal online.", error);
      });

    return () => {
      ativo = false;
    };
  }, [tela, alunoDoPortal, usuarioLogado]);

  function corDaFaixa(faixa) {
    const faixaFormatada = faixa.toLowerCase();

    if (faixaFormatada === "branca") return "#ffffff";
    if (faixaFormatada === "cinza") return "#9ca3af";
    if (faixaFormatada === "amarela") return "#facc15";
    if (faixaFormatada === "laranja") return "#fb923c";
    if (faixaFormatada === "verde") return "#22c55e";
    if (faixaFormatada === "azul") return "#2563eb";
    if (faixaFormatada === "roxa") return "#9333ea";
    if (faixaFormatada === "marrom") return "#78350f";
    if (faixaFormatada === "preta") return "#111827";

    return "#111827";
  }

  function formatarData(data) {
    if (!data) return "Não informado";
    if (data.includes("/")) return data;
    return data.split("-").reverse().join("/");
  }

  function formatarCampoData(valor) {
    const numeros = valor.replace(/\D/g, "").slice(0, 8);

    if (numeros.length <= 2) return numeros;
    if (numeros.length <= 4) return `${numeros.slice(0, 2)}/${numeros.slice(2)}`;

    return `${numeros.slice(0, 2)}/${numeros.slice(2, 4)}/${numeros.slice(4)}`;
  }

  const hoje = new Date().toLocaleDateString();

  const presencasHoje = alunos.reduce((total, aluno) => {
    const presencasDoAlunoHoje = aluno.presencas.filter(
      (presenca) => presenca.data === hoje
    );

    return total + presencasDoAlunoHoje.length;
  }, 0);

  const totalPagos = alunos.filter(
    (aluno) => verificarVencimento(aluno) === "Pago"
  ).length;

  const totalPendentes = alunos.filter(
    (aluno) => verificarVencimento(aluno) === "Pendente"
  ).length;

  const totalVencidos = alunos.filter(
    (aluno) => verificarVencimento(aluno) === "Vencido"
  ).length;

  const alunosVencidos = alunos.filter(
    (aluno) => verificarVencimento(aluno) === "Vencido"
  );

  const pagamentosAguardando = alunos.filter(
    (aluno) => {
      const ultimoPagamento = obterUltimoPagamentoDoAluno(pagamentos, aluno.id);

      if (ultimoPagamento) {
        return ultimoPagamento.status === "Aguardando";
      }

      return aluno.statusPagamento === "Aguardando";
    }
  );

  const cobrancasVencemEmBreve = alunos.filter((aluno) => {
    const status = verificarVencimento(aluno);
    const diasRestantes = calcularDiasParaVencer(aluno);

    return status === "Pendente" && diasRestantes > 0 && diasRestantes <= 4;
  });

  const cobrancasPendentes = alunos.filter((aluno) => {
    const status = verificarVencimento(aluno);
    const diasRestantes = calcularDiasParaVencer(aluno);

    return status === "Pendente" && (diasRestantes === 0 || diasRestantes > 4);
  });

  const avisosPagamentoAguardando = pagamentosAguardando.map((aluno) => ({
    id: `pagamento-${aluno.id}`,
    mensagem: `Pagamento aguardando confirmação: ${aluno.nome}`,
    data: aluno.dataEnvioComprovante || "Agora",
  }));

  const avisosDoPainel = [...avisosPagamentoAguardando, ...avisos];

  const totalArrecadado = alunos.reduce((total, aluno) => {
    return total + aluno.historicoPagamentos.reduce((soma, pagamento) => {
      return soma + pagamento.valor;
    }, 0);
  }, 0);

  const totalPendenteReceber = alunos
    .filter((aluno) => verificarVencimento(aluno) !== "Pago")
    .reduce((total, aluno) => {
      return total + calcularValorComJuros(aluno);
    }, 0);

  const valorEsperadoMes = alunos.reduce((total, aluno) => {
    return total + aluno.mensalidade;
  }, 0);

  function obterResumoPorTurma(nomeTurma) {
    const alunosDaTurma = alunos.filter(
      (aluno) => (aluno.turma || "Adultos") === nomeTurma
    );

    return {
      turma: nomeTurma,
      alunos: alunosDaTurma.length,
      pagos: alunosDaTurma.filter((aluno) => verificarVencimento(aluno) === "Pago").length,
      pendentes: alunosDaTurma.filter((aluno) => verificarVencimento(aluno) === "Pendente").length,
      vencidos: alunosDaTurma.filter((aluno) => verificarVencimento(aluno) === "Vencido").length,
      aguardando: alunosDaTurma.filter((aluno) => verificarVencimento(aluno) === "Aguardando").length,
      previsto: alunosDaTurma.reduce((total, aluno) => total + aluno.mensalidade, 0),
      receber: alunosDaTurma
        .filter((aluno) => verificarVencimento(aluno) !== "Pago")
        .reduce((total, aluno) => total + calcularValorComJuros(aluno), 0),
      presencasHoje: alunosDaTurma.reduce((total, aluno) => {
        return total + aluno.presencas.filter((presenca) => presenca.data === hoje).length;
      }, 0),
    };
  }

  const resumoTurmas = ["Kids", "Adultos"].map(obterResumoPorTurma);
  const resumoFinanceiroDashboard = [
    {
      rotulo: "Pagas",
      valor: totalPagos,
      classe: "pago",
    },
    {
      rotulo: "Pendentes",
      valor: totalPendentes,
      classe: "pendente",
    },
    {
      rotulo: "Vencidas",
      valor: totalVencidos,
      classe: "vencido",
    },
    {
      rotulo: "Aguardando",
      valor: pagamentosAguardando.length,
      classe: "aguardando",
    },
  ];
  const maxResumoFinanceiro = Math.max(
    ...resumoFinanceiroDashboard.map((item) => item.valor),
    1
  );
  const presencaTurmasDashboard = resumoTurmas.map((resumo) => ({
    rotulo: resumo.turma,
    valor: resumo.presencasHoje,
    alunos: resumo.alunos,
  }));
  const maxPresencasTurmaDashboard = Math.max(
    ...presencaTurmasDashboard.map((item) => item.valor),
    1
  );
  const arrecadacaoPorMes = new Map();

  pagamentos
    .filter((pagamento) => pagamento.status === "Pago")
    .forEach((pagamento) => {
      const dataPagamento = dataBrasilParaDate(
        pagamento.data_pagamento || pagamento.criado_em
      );

      if (!dataPagamento) return;

      const chave = `${dataPagamento.getFullYear()}-${String(dataPagamento.getMonth() + 1).padStart(2, "0")}`;
      const registroAtual = arrecadacaoPorMes.get(chave) || {
        chave,
        rotulo: dataPagamento.toLocaleDateString("pt-BR", {
          month: "short",
          year: "2-digit",
        }),
        valor: 0,
      };

      arrecadacaoPorMes.set(chave, {
        ...registroAtual,
        valor: registroAtual.valor + Number(pagamento.valor || 0),
      });
    });

  const arrecadacaoMensalDashboard = [...arrecadacaoPorMes.values()]
    .sort((a, b) => a.chave.localeCompare(b.chave))
    .slice(-6);
  const maxArrecadacaoMensalDashboard = Math.max(
    ...arrecadacaoMensalDashboard.map((item) => item.valor),
    1
  );
  const alunosPorIdDashboard = new Map(
    alunos.map((aluno) => [String(aluno.id), aluno])
  );
  const pagamentosConsolidadosDashboard = [
    ...pagamentos.reduce((mapa, pagamento) => {
      const dataPagamento = dataBrasilParaDate(
        pagamento.data_pagamento || pagamento.criado_em
      );
      const chaveCiclo = dataPagamento
        ? `${pagamento.aluno_id}-${dataPagamento.getFullYear()}-${dataPagamento.getMonth()}`
        : `${pagamento.aluno_id}-${pagamento.id}`;
      const pagamentoAtual = mapa.get(chaveCiclo);
      const prioridadeStatus = {
        Pago: 4,
        Rejeitado: 3,
        Aguardando: 2,
        Pendente: 1,
      };
      const prioridadePagamento = prioridadeStatus[pagamento.status] || 0;
      const prioridadeAtual = prioridadeStatus[pagamentoAtual?.status] || 0;
      const pagamentoMaisRecente =
        dataPagamentoParaTempo(pagamento) > dataPagamentoParaTempo(pagamentoAtual || {});

      if (
        !pagamentoAtual ||
        prioridadePagamento > prioridadeAtual ||
        (prioridadePagamento === prioridadeAtual && pagamentoMaisRecente)
      ) {
        mapa.set(chaveCiclo, pagamento);
      }

      return mapa;
    }, new Map()).values(),
  ];
  const atividadesRecentesDashboard = [
    ...pagamentosConsolidadosDashboard.map((pagamento) => {
      const aluno = alunosPorIdDashboard.get(String(pagamento.aluno_id));
      const data = pagamento.data_pagamento || pagamento.criado_em || "";

      return {
        id: `pagamento-${pagamento.id || pagamento.aluno_id}-${data}`,
        tipo: "Pagamento",
        titulo: `${pagamento.status || "Pagamento"} - ${aluno?.nome || "Aluno"}`,
        detalhe: `${formatarMoeda(pagamento.valor)}${data ? ` em ${dataISOParaBrasil(data.split("T")[0])}` : ""}`,
        tempo: dataPagamentoParaTempo(pagamento),
      };
    }),
    ...presencas.map((presenca, indice) => ({
      id: `presenca-${presenca.alunoId || presenca.nome}-${presenca.data}-${presenca.hora || indice}`,
      tipo: "Presença",
      titulo: presenca.nome || alunosPorIdDashboard.get(String(presenca.alunoId))?.nome || "Aluno",
      detalhe: `${presenca.data || "Data não informada"}${presenca.hora ? ` às ${presenca.hora}` : ""}`,
      tempo: dataBrasilParaDate(presenca.data)?.getTime() || 0,
    })),
    ...avisosDoPainel
      .filter((aviso) => !String(aviso.mensagem || "").startsWith("Pagamento "))
      .map((aviso) => ({
        id: `aviso-${aviso.id}`,
        tipo: "Aviso",
        titulo: aviso.mensagem,
        detalhe: aviso.data,
        tempo: 0,
      })),
  ]
    .sort((a, b) => b.tempo - a.tempo)
    .slice(0, 6);
  const alunosAtencaoRelatorio = alunos.filter(
    (aluno) =>
      verificarVencimento(aluno) === "Vencido" ||
      verificarVencimento(aluno) === "Aguardando"
  );

  function formatarMoeda(valor) {
    return Number(valor || 0).toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
    });
  }

  function obterDataSemHora(data = new Date()) {
    return new Date(data.getFullYear(), data.getMonth(), data.getDate());
  }

  function dataBrasilParaDate(data) {
    if (!data) return null;
    if (data instanceof Date) return obterDataSemHora(data);

    const texto = String(data);
    if (/^\d{4}-\d{2}-\d{2}/.test(texto)) {
      const [ano, mes, dia] = texto.slice(0, 10).split("-").map(Number);
      return new Date(ano, mes - 1, dia);
    }

    const partes = texto.split("/");
    if (partes.length !== 3) return null;

    const [dia, mes, ano] = partes.map(Number);
    if (!dia || !mes || !ano) return null;

    return new Date(ano, mes - 1, dia);
  }

  function pagamentoDoMesAtual(aluno) {
    const ultimoPagamento = dataBrasilParaDate(aluno?.ultimoPagamento);
    const agora = new Date();

    return Boolean(
      ultimoPagamento &&
      ultimoPagamento.getMonth() === agora.getMonth() &&
      ultimoPagamento.getFullYear() === agora.getFullYear()
    );
  }

  function pagamentoNoCicloAtual(pagamento) {
    const dataPagamento = dataBrasilParaDate(
      pagamento?.data_pagamento || pagamento?.criado_em
    );
    const agora = new Date();

    return Boolean(
      dataPagamento &&
      dataPagamento.getMonth() === agora.getMonth() &&
      dataPagamento.getFullYear() === agora.getFullYear()
    );
  }

  function obterPagamentoAguardandoAberto(idAluno, listaPagamentos = pagamentos) {
    return listaPagamentos
      .filter((pagamento) =>
        String(pagamento.aluno_id) === String(idAluno) &&
        pagamento.status === "Aguardando" &&
        pagamentoNoCicloAtual(pagamento)
      )
      .sort((a, b) => dataPagamentoParaTempo(b) - dataPagamentoParaTempo(a))[0];
  }

  function obterDataVencimentoAtual(aluno) {
    const diaVencimento = Number(aluno?.vencimento || DIA_COBRANCA_PADRAO);

    const agora = new Date();
    const ultimoDiaDoMes = new Date(
      agora.getFullYear(),
      agora.getMonth() + 1,
      0
    ).getDate();
    const dia = Math.min(diaVencimento, ultimoDiaDoMes);

    return new Date(agora.getFullYear(), agora.getMonth(), dia);
  }

  function formatarDataCobranca(aluno) {
    const dataVencimento = obterDataVencimentoAtual(aluno);
    if (!dataVencimento) return "Nao informada";

    return dataVencimento.toLocaleDateString("pt-BR");
  }

  function calcularDiasParaVencer(aluno) {
    const dataVencimento = obterDataVencimentoAtual(aluno);
    if (!dataVencimento) return 0;

    const diferenca = dataVencimento.getTime() - obterDataSemHora().getTime();
    return Math.max(0, Math.ceil(diferenca / (1000 * 60 * 60 * 24)));
  }

  function obterCorStatusFinanceiro(status) {
    if (status === "Pago") return "#22c55e";
    if (status === "Aguardando") return "#facc15";
    if (status === "Vencido") return "#f97316";
    return "#ef4444";
  }

  function obterResumoFinanceiro(aluno) {
    const status = verificarVencimento(aluno);
    const diasRestantes = calcularDiasParaVencer(aluno);
    const diasAtraso = calcularDiasAtraso(aluno);

    let mensagem;

    if (status === "Pago") {
      mensagem = "Mensalidade deste mes confirmada.";
    } else if (status === "Aguardando") {
      mensagem = "Comprovante enviado, aguardando confirmacao.";
    } else if (status === "Vencido") {
      mensagem = `${diasAtraso} dia${diasAtraso === 1 ? "" : "s"} em atraso.`;
    } else if (diasRestantes > 0) {
      mensagem = `Faltam ${diasRestantes} dia${diasRestantes === 1 ? "" : "s"} para vencer.`;
    } else {
      mensagem = "Vence hoje.";
    }

    return {
      status,
      cor: obterCorStatusFinanceiro(status),
      mensagem,
      diasRestantes,
      diasAtraso,
      cobranca: formatarDataCobranca(aluno),
      valorBase: formatarMoeda(aluno?.mensalidade),
      valorAtualizado: formatarMoeda(calcularValorComJuros(aluno || {})),
      ultimoPagamento: aluno?.ultimoPagamento || "Nenhum pagamento confirmado",
    };
  }

  function limparTelefoneWhatsApp(telefoneAluno) {
    const numeros = String(telefoneAluno || "").replace(/\D/g, "");

    if (!numeros) return "";
    if (numeros.startsWith("55")) return numeros;
    if (numeros.length >= 10 && numeros.length <= 11) return `55${numeros}`;

    return numeros;
  }

  function criarMensagemCobranca(aluno) {
    const resumo = obterResumoFinanceiro(aluno);
    const valor =
      verificarVencimento(aluno) === "Vencido"
        ? resumo.valorAtualizado
        : resumo.valorBase;

    return [
      `Olá, ${aluno.nome}.`,
      `Aqui é da ${APP_NAME}.`,
      `Consta uma mensalidade com status: ${resumo.status}.`,
      `Cobrança: ${resumo.cobranca}.`,
      `Valor: ${valor}.`,
      resumo.mensagem,
      "Pode nos enviar o comprovante pelo portal do aluno, por favor?",
    ].join("\n");
  }

  async function copiarMensagemCobranca(aluno) {
    const mensagem = criarMensagemCobranca(aluno);

    try {
      await navigator.clipboard.writeText(mensagem);
      alert(`Mensagem de cobrança copiada para ${aluno.nome}.`);
    } catch (error) {
      console.error("Erro ao copiar mensagem.", error);
      window.prompt("Copie a mensagem abaixo:", mensagem);
    }
  }

  function abrirWhatsAppCobranca(aluno) {
    const telefoneAluno = limparTelefoneWhatsApp(aluno.telefone);
    const mensagem = encodeURIComponent(criarMensagemCobranca(aluno));
    const url = telefoneAluno
      ? `https://wa.me/${telefoneAluno}?text=${mensagem}`
      : `https://wa.me/?text=${mensagem}`;

    window.open(url, "_blank", "noopener,noreferrer");
  }

  function verificarVencimento(aluno) {
    if (!aluno) {
      return "Pendente";
    }

    if (aluno.statusPagamento === "Aguardando") {
      return "Aguardando";
    }

    if (aluno.statusPagamento === "Pago" && pagamentoDoMesAtual(aluno)) {
      return "Pago";
    }

    const dataVencimento = obterDataVencimentoAtual(aluno);
    if (!dataVencimento) {
      return "Pendente";
    }

    if (obterDataSemHora() > dataVencimento) {
      return "Vencido";
    }

    return "Pendente";
  }

  function calcularDiasAtraso(aluno) {
    if (verificarVencimento(aluno) !== "Vencido") {
      return 0;
    }

    const dataVencimento = obterDataVencimentoAtual(aluno);
    if (!dataVencimento) return 0;

    const diferenca = obterDataSemHora().getTime() - dataVencimento.getTime();
    return Math.max(0, Math.floor(diferenca / (1000 * 60 * 60 * 24)));
  }

  function calcularValorComJuros(aluno) {
    if (verificarVencimento(aluno) !== "Vencido") {
      return aluno.mensalidade;
    }

    const multa = 10;
    const jurosPorDia = 1;

    return aluno.mensalidade + multa + calcularDiasAtraso(aluno) * jurosPorDia;
  }

  function bloquearPresencaSeMensalidadeVencida(aluno) {
    if (verificarVencimento(aluno) !== "Vencido") {
      return false;
    }

    alert(
      `Presenca bloqueada.\n\n${aluno.nome} esta com mensalidade vencida.\nValor atualizado: ${formatarMoeda(calcularValorComJuros(aluno))}`
    );
    return true;
  }

  function avisarPendenciaFinanceiraNaPresenca(aluno) {
    const status = verificarVencimento(aluno);

    if (status === "Pendente") {
      alert(
        `Atenção.\n\n${aluno.nome} está com mensalidade pendente.\nCobrança: ${formatarDataCobranca(aluno)}\nValor: ${formatarMoeda(aluno.mensalidade)}`
      );
      return true;
    }

    if (status === "Aguardando") {
      alert(
        `Atenção.\n\n${aluno.nome} enviou comprovante e está aguardando confirmação do mestre.`
      );
      return true;
    }

    return false;
  }

  // if (
  //   (tela === "mensalidades" || tela === "pagamentos" || tela === "relatorios") &&
  //   tipoUsuario !== "diretor"
  //) {
  //   setTela("dashboard");
  // }

  if (tela === "inicio") {
    return (
      <div
        className="telaInicial"
        style={{
          backgroundImage: `
          linear-gradient(rgba(0,0,0,0.75), rgba(0,0,0,0.9)),
          url(${capa})
        `,
        }}
      >
        <div className="conteudoInicial">
          <h1>ARIRAMBA JIU-JITSU SCHOOL</h1>

          <h3>DISCIPLINA • RESPEITO • EVOLUÇÃO</h3>

          <p>Sistema de gestão para sua academia</p>

          <button onClick={() => setTela("login")}>
            ENTRAR NO SISTEMA
          </button>
        </div>

      </div>
    );
  }
  if (tela === "login") {
    return (
      <div className="telaLogin">
        <div className="caixaLogin">
          <img src={logo} alt={`Logo ${APP_NAME}`} />
          <h1>Acesso ao Sistema</h1>

          <input
            type="text"
            placeholder="Usuário"
            value={usuario}
            onChange={(e) => setUsuario(e.target.value)}
          />

          <input
            type="password"
            placeholder="Senha"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
          />

          <button
            onClick={fazerLogin}
            disabled={loginEmAndamento}
          >
            {loginEmAndamento ? "Entrando..." : "Entrar no Sistema"}
          </button>
        </div>

        <ModalMensagem
          modal={modalMensagem}
          onFechar={fecharModalMensagem}
        />
      </div>
    );
  }

  if (tela === "cadastroProfessor") {
    return (
      <div className="layoutSistema">
        {menuAberto && (
          <Menu
            setTela={setTela}
            tipoUsuario={tipoUsuario}
            setMenuAberto={setMenuAberto}
            onSair={sairDoSistema}
          />
        )}

        <main className="conteudoSistema">
          <h1>Cadastrar Professor</h1>

          <div className="formulario">

            <input
              type="text"
              name="novoProfessorNome"
              placeholder="Nome do professor"
              autoComplete="off"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
            />

            <input
              type="text"
              name="novoProfessorUsuario"
              placeholder="Usuário"
              autoComplete="off"
              value={usuarioAluno}
              onChange={(e) => setUsuarioAluno(e.target.value)}
            />

            <input
              type="password"
              name="novaSenhaProfessor"
              placeholder="Senha"
              autoComplete="new-password"
              value={senhaAluno}
              onChange={(e) => setSenhaAluno(e.target.value)}
            />

            <button
              onClick={salvarProfessor}
            >
              Salvar Professor
            </button>

            <button
              className="botaoVoltar"
              onClick={() => setTela("dashboard")}
            >
              Voltar
            </button>

          </div>
        </main>
      </div>
    );
  }

  if (tela === "cadastro") {
    if (tipoUsuario !== "diretor" && !alunoEditando) {
      return null;
    }

    const fotoCadastroAluno = alunoEditando
      ? foto
      : fotoTemporariaPertenceAoContextoAtual()
        ? foto
        : "";

    return (
      <div className="layoutSistema">
        {menuAberto && (
          <Menu
            setTela={setTela}
            tipoUsuario={tipoUsuario}
            setMenuAberto={setMenuAberto}
            onSair={sairDoSistema}
          />
        )}

        <main className="conteudoSistema">
          <h1>Cadastrar Aluno</h1>

          <div className="formulario">

            <input
              type="text"
              placeholder="Nome do aluno"
              value={nome}
              disabled={tipoUsuario !== "diretor"}
              onChange={(e) => setNome(e.target.value)}
            />

            <input
              type="text"
              placeholder="Peso"
              value={peso}
              disabled={tipoUsuario !== "diretor"}
              onChange={(e) => setPeso(e.target.value)}
            />

            <input
              type="text"
              inputMode="numeric"
              placeholder="Nascimento (dd/mm/aaaa)"
              value={dataNascimento}
              disabled={tipoUsuario !== "diretor"}
              onChange={(e) => setDataNascimento(formatarCampoData(e.target.value))}
            />

            <input
              type="text"
              placeholder="Faixa"
              value={faixa}
              disabled={tipoUsuario !== "diretor"}
              onChange={(e) => setFaixa(e.target.value)}
            />

            <input
              type="text"
              placeholder="Grau"
              value={grau}
              disabled={tipoUsuario !== "diretor"}
              onChange={(e) => setGrau(e.target.value)}
            />

            <select
              value={turma}
              disabled={tipoUsuario !== "diretor"}
              onChange={(e) => setTurma(e.target.value)}
            >
              <option value="Adultos">Turma Adultos</option>
              <option value="Kids">Turma Kids</option>
            </select>

            <input
              type="text"
              inputMode="numeric"
              placeholder="Inicio (dd/mm/aaaa)"
              value={dataInicio}
              disabled={tipoUsuario !== "diretor"}
              onChange={(e) => setDataInicio(formatarCampoData(e.target.value))}
            />

            {tipoUsuario === "diretor" && (
              <>
                <input
                  type="text"
                  placeholder="Usuário do aluno"
                  value={usuarioAluno}
                  autoComplete="off"
                  onChange={(e) => setUsuarioAluno(e.target.value)}
                />

                <input
                  type="password"
                  placeholder="Senha inicial"
                  value={senhaAluno}
                  autoComplete="new-password"
                  onChange={(e) => setSenhaAluno(e.target.value)}
                />
              </>
            )}

            <input
              type="text"
              placeholder="Telefone"
              value={telefone}
              disabled={tipoUsuario !== "diretor"}
              onChange={(e) => setTelefone(e.target.value)}
            />

            <input
              type="text"
              placeholder="Responsável"
              value={responsavel}
              disabled={tipoUsuario !== "diretor"}
              onChange={(e) => setResponsavel(e.target.value)}
            />

            <input
              type="text"
              placeholder="Tipo sanguíneo"
              value={tipoSanguineo}
              disabled={tipoUsuario !== "diretor"}
              onChange={(e) => setTipoSanguineo(e.target.value)}
            />

            <textarea
              placeholder="Problemas de saúde"
              value={saude}
              disabled={tipoUsuario !== "diretor"}
              onChange={(e) => setSaude(e.target.value)}
            />

            <textarea
              placeholder="Medicamentos"
              value={medicamentos}
              disabled={tipoUsuario !== "diretor"}
              onChange={(e) => setMedicamentos(e.target.value)}
            />

            <textarea
              placeholder="Observações"
              value={observacoes}
              onChange={(e) => setObservacoes(e.target.value)}
            />

            {tipoUsuario === "diretor" && (
              <>
                <input
                  type="number"
                  placeholder="Mensalidade"
                  value={mensalidade}
                  onChange={(e) => setMensalidade(e.target.value)}
                />

                <input
                  type="number"
                  placeholder="Dia da cobranca"
                  value={vencimento}
                  onChange={(e) => setVencimento(e.target.value)}
                />
              </>
            )}

            {tipoUsuario === "diretor" && (
              <div className="opcoesFotoAluno">
                <label htmlFor="fotoAlunoCamera">
                  Tirar foto
                </label>

                <input
                  id="fotoAlunoCamera"
                  className="inputFotoAluno"
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={async (e) => {
                    const arquivo = e.target.files[0];
                    e.target.value = "";

                    if (arquivo) {
                      await prepararFotoParaAjuste(arquivo);
                    }
                  }}
                />

                <label htmlFor="fotoAlunoGaleria">
                  Escolher da galeria
                </label>

                <input
                  id="fotoAlunoGaleria"
                  className="inputFotoAluno"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={async (e) => {
                    const arquivo = e.target.files[0];
                    e.target.value = "";

                    if (arquivo) {
                      await prepararFotoParaAjuste(arquivo);
                    }
                  }}
                />
              </div>
            )}

            {fotoCadastroAluno && (
              <>
                <img
                  src={fotoCadastroAluno}
                  alt="Preview"
                  className="previewFoto"
                />

                <button
                  type="button"
                  onClick={() => abrirAjusteFoto(fotoCadastroAluno)}
                >
                  Ajustar foto
                </button>
              </>
            )}

            {ajusteFotoAberto && (
              <AjustadorFoto
                foto={fotoParaAjustar}
                zoom={zoomFoto}
                posicaoX={posicaoFotoX}
                posicaoY={posicaoFotoY}
                onZoom={setZoomFoto}
                onPosicaoX={setPosicaoFotoX}
                onPosicaoY={setPosicaoFotoY}
                onTamanhoPreview={setTamanhoPreviewFoto}
                onCancelar={cancelarAjusteFoto}
                onConfirmar={confirmarAjusteFoto}
              />
            )}

            <button onClick={salvarAluno} disabled={salvandoAluno}>
              {salvandoAluno ? "Salvando..." : alunoEditando ? "Atualizar Aluno" : "Salvar Aluno"}
            </button>

            <button
              className="botaoVoltar"
              onClick={() => {
                limparFormulario();
                setTela("dashboard");
              }}
            >
              Voltar
            </button>
          </div>
        </main>
      </div>
    );
  }

  if (tela === "lista") {
    return (
      <div className="layoutSistema">
        {menuAberto && (
          <Menu
            setTela={setTela}
            tipoUsuario={tipoUsuario}
            setMenuAberto={setMenuAberto}
            onSair={sairDoSistema}
          />
        )}

        <main className="conteudoSistema">
          <h1>Lista de Alunos</h1>

          <input
            type="text"
            placeholder="Buscar aluno..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="inputBusca"
          />

          <div className="filtrosTurma">
            {["Todas", "Kids", "Adultos"].map((opcao) => (
              <button
                key={opcao}
                className={filtroTurma === opcao ? "ativo" : ""}
                onClick={() => setFiltroTurma(opcao)}
              >
                {opcao}
              </button>
            ))}
          </div>

          <div className="lista">
            {alunosFiltrados.length === 0 ? (
              <p>Nenhum aluno encontrado.</p>
            ) : (
              alunosFiltrados.map((aluno) => (
                <CardAluno key={aluno.id}>

                  {obterFotoAluno(aluno) && (
                    <img
                      src={obterFotoAluno(aluno)}
                      alt={aluno.nome}
                      className="fotoAlunoLista"
                    />
                  )}

                  <h2>{aluno.nome}</h2>
                  <p>Telefone: {aluno.telefone || "Nao informado"}</p>
                  <p>Turma: {aluno.turma || "Adultos"}</p>
                  <p>Faixa: {aluno.faixa}</p>
                  {tipoUsuario === "diretor" && (
                    <>
                      <p>Mensalidade: {formatarMoeda(aluno.mensalidade)}</p>
                      <p>
                        Último pagamento:{" "}
                        {aluno.ultimoPagamento || "Nenhum pagamento registrado"}
                      </p>

                      <p
                        style={{
                          color:
                            verificarVencimento(aluno) === "Pago"
                              ? "#22c55e"
                              : verificarVencimento(aluno) === "Vencido"
                                ? "#f97316"
                                : "#ef4444",
                          fontWeight: "bold",
                        }}
                      >
                        {aluno.statusPagamento === "Pago"
                          ? "Pago"
                          : "Pendente"}
                      </p>
                      {aluno.statusPagamento === "Pendente" ? (
                        <Botao
                          tipo="success"
                          onClick={() => marcarComoPago(aluno.id)}
                        >
                          Confirmar Pagamento
                        </Botao>
                      ) : (
                        <button onClick={() => marcarComoPendente(aluno.id)}>
                          Cancelar Confirmação
                        </button>
                      )}
                    </>
                  )}

                  {aluno.grau && <p>Grau: {aluno.grau}</p>}

                  <button onClick={() => abrirCarteirinha(aluno)}>
                    Gerar Carteirinha
                  </button>

                  <button onClick={() => editarAluno(aluno)}>
                    {tipoUsuario === "diretor" ? "Editar Aluno" : "Observações do Aluno"}
                  </button>

                  {tipoUsuario === "diretor" && (
                    <button
                      onClick={() => resetarSenhaAluno(aluno)}
                    >
                      Resetar Senha
                    </button>
                  )}

                  {tipoUsuario === "diretor" && (
                    <Botao
                      tipo="danger"
                      onClick={() => removerAluno(aluno.id)}
                    >
                      Remover Aluno
                    </Botao>
                  )}

                  <Botao
                    tipo="success"
                    onClick={() => registrarPresenca(aluno.id)}
                  >
                    Registrar Presença
                  </Botao>
                </CardAluno>
              ))
            )}

            {alunoCarteirinha && (
              <div className="areaCarteirinha">
                <div className="carteirinha">
                  <div className="ladoFoto">
                    <img src={logo} alt="Logo" className="logoCarteirinha" />

                    {(alunoCarteirinha.foto || alunoCarteirinha.fotoUrl) && (
                      <img
                        src={alunoCarteirinha.foto || alunoCarteirinha.fotoUrl}
                        alt={alunoCarteirinha.nome}
                        className="fotoCarteirinha"
                      />
                    )}

                    <div className="faixaMini">
                      <div
                        style={{
                          width: "70%",
                          background: corDaFaixa(alunoCarteirinha.faixa),
                        }}
                      />

                      <div
                        style={{
                          width: "30%",
                          background:
                            alunoCarteirinha.faixa.toLowerCase() === "preta"
                              ? "#dc2626"
                              : "#111827",

                          display: "flex",
                          justifyContent: "space-evenly",
                          alignItems: "center",
                        }}
                      >
                        {alunoCarteirinha.grau && (
                          <>
                            <div
                              style={{
                                width: "4px",
                                height: "100%",
                                background: "white",
                              }}
                            />

                            <div
                              style={{
                                width: "4px",
                                height: "100%",
                                background: "white",
                              }}
                            />

                            <div
                              style={{
                                width: "4px",
                                height: "100%",
                                background: "white",
                              }}
                            />
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="infoCarteirinha">
                    <h2>{alunoCarteirinha.nome}</h2>
                    <p>Faixa: {alunoCarteirinha.faixa}</p>
                    <p>Turma: {alunoCarteirinha.turma || "Adultos"}</p>
                    {alunoCarteirinha.grau && (
                      <p>Grau: {alunoCarteirinha.grau}</p>
                    )}

                    <p>Nascimento: {formatarData(alunoCarteirinha.dataNascimento)}</p>
                    <p>Carteira emitida: {new Date().getFullYear()}</p>
                    <p>Renovação: Próxima troca de faixa</p>
                    <p>ID: {alunoCarteirinha.id}</p>
                  </div>

                  <div className="qrcodeFake">
                    <QRCodeCanvas
                      value={criarValorQRCodeAluno(alunoCarteirinha)}
                      size={80}
                    />
                  </div>
                </div>

                <button onClick={() => baixarCarteirinhaPNG(alunoCarteirinha)}>
                  Baixar Carteirinha
                </button>

                <button onClick={() => setAlunoCarteirinha(null)}>Fechar</button>
              </div>
            )}
          </div>
          <button
            className="botaoVoltar"
            onClick={() => {
              setTela(tipoUsuario === "professor" ? "portalProfessor" : "dashboard");
              setMenuAberto(false);
            }}
          >
            Voltar
          </button>

        </main>
      </div>
    );
  }

  if (tela === "mensalidades") {
    return (
      <div className="layoutSistema">
        {menuAberto && (
          <Menu
            setTela={setTela}
            tipoUsuario={tipoUsuario}
            setMenuAberto={setMenuAberto}
            onSair={sairDoSistema}
          />
        )}

        <main className="conteudoSistema">
          <h1>Controle de Mensalidades</h1>

          <div className="estatisticas">
            <div className="cardEstatistica pagos">
              <h3>Pagos</h3>
              <h2>{totalPagos}</h2>
            </div>

            <div className="cardEstatistica pendentes">
              <h3>Pendentes</h3>
              <h2>{totalPendentes}</h2>
            </div>

            <div className="cardEstatistica vencidas">
              <h3>Mensalidades Vencidas</h3>
              <h2>{totalVencidos}</h2>
            </div>

            <div className="cardEstatistica">
              <h3>Total Arrecadado</h3>
              <h2>{formatarMoeda(totalArrecadado)}</h2>
            </div>

            <div className="cardEstatistica">
              <h3>Total a Receber</h3>
              <h2>{formatarMoeda(totalPendenteReceber)}</h2>
            </div>

            <div className="cardEstatistica">
              <h3>Previsão do Mês</h3>
              <h2>{formatarMoeda(valorEsperadoMes)}</h2>
            </div>

          </div>

          <section className="centralCobranca">
            <div className="cabecalhoCentralCobranca">
              <div>
                <h2>Central de Cobrança</h2>
                <p>Alunos separados por prioridade para facilitar o contato.</p>
              </div>
              <strong>
                {totalPendenteReceber > 0
                  ? formatarMoeda(totalPendenteReceber)
                  : "Tudo em dia"}
              </strong>
            </div>

            <div className="resumoCobrancaRapida">
              <span>Vence em breve: {cobrancasVencemEmBreve.length}</span>
              <span>Pendentes: {cobrancasPendentes.length}</span>
              <span>Vencidos: {alunosVencidos.length}</span>
              <span>Aguardando: {pagamentosAguardando.length}</span>
            </div>

            <div className="gruposCobranca">
              {[
                {
                  titulo: "Vence em breve",
                  descricao: "Faltam ate 4 dias para vencer.",
                  alunos: cobrancasVencemEmBreve,
                  classe: "breve",
                },
                {
                  titulo: "Pendentes",
                  descricao: "Mensalidades ainda sem pagamento confirmado.",
                  alunos: cobrancasPendentes,
                  classe: "pendente",
                },
                {
                  titulo: "Vencidos",
                  descricao: "Cobranças que ja passaram do vencimento.",
                  alunos: alunosVencidos,
                  classe: "vencido",
                },
                {
                  titulo: "Aguardando confirmação",
                  descricao: "Alunos que enviaram comprovante para analise.",
                  alunos: pagamentosAguardando,
                  classe: "aguardando",
                },
              ].map((grupo) => (
                <div className={`grupoCobranca ${grupo.classe}`} key={grupo.titulo}>
                  <div className="tituloGrupoCobranca">
                    <div>
                      <h3>{grupo.titulo}</h3>
                      <p>{grupo.descricao}</p>
                    </div>
                    <strong>{grupo.alunos.length}</strong>
                  </div>

                  {grupo.alunos.length === 0 ? (
                    <p className="estadoVazioCobranca">Nenhum aluno neste grupo.</p>
                  ) : (
                    grupo.alunos.map((aluno) => {
                      const resumo = obterResumoFinanceiro(aluno);
                      const valor =
                        verificarVencimento(aluno) === "Vencido"
                          ? resumo.valorAtualizado
                          : resumo.valorBase;

                      return (
                        <div className="itemCobranca" key={`${grupo.titulo}-${aluno.id}`}>
                          <div className="dadosItemCobranca">
                            <h4>{aluno.nome}</h4>
                            <p>{resumo.mensagem}</p>
                            <span>Cobrança: {resumo.cobranca}</span>
                            <span>Valor: {valor}</span>
                            <span>Telefone: {aluno.telefone || "Nao informado"}</span>
                          </div>

                          <div className="acoesCobranca">
                            <button onClick={() => copiarMensagemCobranca(aluno)}>
                              Copiar mensagem
                            </button>
                            <button onClick={() => abrirWhatsAppCobranca(aluno)}>
                              Abrir WhatsApp
                            </button>
                            {verificarVencimento(aluno) !== "Pago" && (
                              <button
                                disabled={pagamentoEmAndamento}
                                onClick={() => marcarComoPago(aluno.id)}
                              >
                                Confirmar pagamento
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              ))}
            </div>
          </section>

          <button
            className="botaoVoltar"
            onClick={() => {
              setTela("dashboard");
              setMenuAberto(false);
            }}
          >
            Voltar
          </button>
        </main>
      </div>
    );
  }

  if (tela === "pagamentos") {
    return (
      <div className="layoutSistema">

        {menuAberto && (
          <>
            <div
              className="fundoMenuMobile"
              onClick={() => {
                setMenuAberto(false);
                document.body.style.overflow = "auto";
              }}
            ></div>

            <Menu
              setTela={setTela}
              tipoUsuario={tipoUsuario}
              setMenuAberto={setMenuAberto}
              onSair={sairDoSistema}
            />
          </>
        )}
        <main className="conteudoSistema">
          <button
            className="botaoMenuMobile"
            onClick={() => setMenuAberto(!menuAberto)}
          >
            ☰
          </button>
          <TituloTela titulo="Controle de Pagamentos" />
          <div className="cardEstatistica">
            <h3>Aguardando Confirmação</h3>

            <h2>{pagamentosAguardando.length}</h2>
          </div>

          <div className="lista">
            {alunos.map((aluno) => (
              <CardAluno key={aluno.id}>
                <h2>{aluno.nome}</h2>

                {(() => {
                  const resumo = obterResumoFinanceiro(aluno);

                  return (
                    <div className="resumoFinanceiroMestre">
                      <div className="linhaResumoFinanceiro destaque">
                        <span>Status do mes</span>
                        <strong style={{ color: resumo.cor }}>{resumo.status}</strong>
                      </div>
                      <div className="linhaResumoFinanceiro">
                        <span>Cobranca</span>
                        <strong>{resumo.cobranca}</strong>
                      </div>
                      <div className="linhaResumoFinanceiro">
                        <span>Mensalidade</span>
                        <strong>{resumo.valorBase}</strong>
                      </div>
                      {verificarVencimento(aluno) === "Vencido" && (
                        <div className="linhaResumoFinanceiro alerta">
                          <span>Valor atualizado</span>
                          <strong>{resumo.valorAtualizado}</strong>
                        </div>
                      )}
                      <div className="avisoResumoFinanceiro" style={{ borderColor: resumo.cor }}>
                        {resumo.mensagem}
                      </div>
                      <div className="linhaResumoFinanceiro">
                        <span>Ultimo pagamento</span>
                        <strong>{resumo.ultimoPagamento}</strong>
                      </div>
                    </div>
                  );
                })()}
                {(aluno.comprovantePagamento || aluno.statusPagamento === "Aguardando") && (
                  <div className="cardAluno">
                    <div className="comprovantePreview">
                      <p>Comprovante enviado:</p>

                      {aluno.comprovantePagamento ? (
                        comprovanteEhImagem(aluno.comprovantePagamento) ? (
                          <img
                            src={aluno.comprovantePagamento}
                            alt="Comprovante"
                            className="imagemComprovante"
                            onClick={() =>
                              setImagemComprovante(aluno.comprovantePagamento)
                            }
                          />
                        ) : (
                          <button
                            type="button"
                            className="arquivoComprovante"
                            onClick={() =>
                              abrirArquivoComprovante(aluno.comprovantePagamento)
                            }
                          >
                            Abrir comprovante
                          </button>
                        )
                      ) : (
                        <p className="avisoSemComprovante">
                          Pagamento informado, mas nenhum comprovante foi anexado.
                        </p>
                      )}
                    </div>

                    <p>
                      Data do envio: {aluno.dataEnvioComprovante}
                    </p>
                  </div>
                )}

                <div className="historicoPagamentos">
                  <h4>Histórico de Pagamentos</h4>

                  {aluno.historicoPagamentos && aluno.historicoPagamentos.length > 0 ? (
                    aluno.historicoPagamentos.map((pagamento, index) => (
                      <p key={index}>
                        {pagamento.data} - {formatarMoeda(pagamento.valor)}
                      </p>
                    ))
                  ) : (
                    <p>Nenhum pagamento no histórico</p>
                  )}
                </div>

                <p
                  style={{
                    color:
                      aluno.statusPagamento === "Aguardando"
                        ? "#facc15"

                        : verificarVencimento(aluno) === "Pago"
                          ? "#22c55e"

                          : verificarVencimento(aluno) === "Vencido"
                            ? "#f97316"

                            : "#ef4444",

                    fontWeight: "bold",
                    fontSize: "18px",
                  }}
                >
                  {aluno.statusPagamento === "Aguardando" &&
                    "Aguardando confirmação"}

                  {verificarVencimento(aluno) === "Pago" &&
                    "Pago"}

                  {verificarVencimento(aluno) === "Pendente" &&
                    aluno.statusPagamento !== "Aguardando" &&
                    "Pendente"}

                  {verificarVencimento(aluno) === "Vencido" &&
                    "Vencido"}
                </p>

                {aluno.statusPagamento === "Pendente" ? (
                  <button
                    disabled={pagamentoEmAndamento}
                    onClick={() => marcarComoPago(aluno.id)}
                  >
                    {pagamentoEmAndamento ? "Confirmando..." : "Confirmar Pagamento"}
                  </button>
                ) : (
                  <button onClick={() => marcarComoPendente(aluno.id)}>
                    Cancelar Confirmação
                  </button>
                )}

                <button onClick={() => gerarReciboPDF(aluno)}>
                  Gerar Recibo PDF
                </button>

                <button onClick={() => rejeitarPagamento(aluno.id)}>
                  Rejeitar Comprovante
                </button>

              </CardAluno>
            ))}
          </div>

          <button onClick={() => setTela("dashboard")}>
            Voltar
          </button>
        </main>
      </div>
    );
  }

  if (tela === "relatorios") {
    return (
      <div className="layoutSistema">
        {menuAberto && (
          <>
            <div
              className="fundoMenuMobile"
              onClick={() => {
                setMenuAberto(false);
                document.body.style.overflow = "auto";
              }}
            ></div>

            <Menu
              setTela={setTela}
              tipoUsuario={tipoUsuario}
              setMenuAberto={setMenuAberto}
              onSair={sairDoSistema}
            />
          </>
        )}


        <main className="conteudoSistema">
          <h1>Relatório Geral</h1>

          <section className="relatorioResumo">
            <div className="blocoRelatorio destaqueRelatorio">
              <span>Total de alunos</span>
              <strong>{alunos.length}</strong>
            </div>
            <div className="blocoRelatorio">
              <span>Presenças hoje</span>
              <strong>{presencasHoje}</strong>
            </div>
            <div className="blocoRelatorio">
              <span>Total arrecadado</span>
              <strong>{formatarMoeda(totalArrecadado)}</strong>
            </div>
            <div className="blocoRelatorio">
              <span>Total a receber</span>
              <strong>{formatarMoeda(totalPendenteReceber)}</strong>
            </div>
          </section>

          <section className="relatorioFinanceiro">
            <div>
              <h2>Financeiro do mês</h2>
              <p>Previsão: {formatarMoeda(valorEsperadoMes)}</p>
              <p>Pagos: {totalPagos}</p>
              <p>Pendentes: {totalPendentes}</p>
              <p>Vencidos: {totalVencidos}</p>
              <p>Aguardando confirmação: {pagamentosAguardando.length}</p>
            </div>

            <div>
              <h2>Turmas</h2>
              {resumoTurmas.map((resumo) => (
                <div className="linhaRelatorioTurma" key={resumo.turma}>
                  <strong>{resumo.turma}</strong>
                  <span>{resumo.alunos} alunos</span>
                  <span>{resumo.presencasHoje} presenças hoje</span>
                  <span>{formatarMoeda(resumo.receber)} a receber</span>
                </div>
              ))}
            </div>
          </section>

          <section className="relatorioAtencao">
            <div className="cabecalhoRelatorioSecao">
              <h2>Alunos que precisam de atenção</h2>
              <strong>{alunosAtencaoRelatorio.length}</strong>
            </div>

            {alunosAtencaoRelatorio.length === 0 ? (
              <p className="estadoVazioCobranca">Nenhum aluno em atraso ou aguardando confirmação.</p>
            ) : (
              <div className="listaRelatorioAlunos">
                {alunosAtencaoRelatorio.map((aluno) => {
                  const resumo = obterResumoFinanceiro(aluno);

                  return (
                    <div className="itemRelatorioAluno" key={aluno.id}>
                      <strong>{aluno.nome}</strong>
                      <span>Turma: {aluno.turma || "Adultos"}</span>
                      <span>Status: {resumo.status}</span>
                      <span>Valor: {resumo.valorAtualizado}</span>
                      <span>{resumo.mensagem}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className="relatorioAtencao">
            <div className="cabecalhoRelatorioSecao">
              <h2>Resumo dos alunos</h2>
              <strong>{alunos.length}</strong>
            </div>

            <div className="listaRelatorioAlunos">
              {alunos.map((aluno) => (
                <div className="itemRelatorioAluno" key={`resumo-${aluno.id}`}>
                  <strong>{aluno.nome}</strong>
                  <span>Turma: {aluno.turma || "Adultos"}</span>
                  <span>Faixa: {aluno.faixa || "Nao informada"}</span>
                  <span>Status: {verificarVencimento(aluno)}</span>
                  <span>Presenças: {aluno.presencas.length}</span>
                </div>
              ))}
            </div>
          </section>

          <button onClick={gerarRelatorioFinanceiroPDF}>
            Gerar Relatório Financeiro PDF
          </button>

          <button onClick={() => setTela("dashboard")}>
            Voltar
          </button>
        </main>
      </div>
    );
  }

  if (tela === "historico") {
    return (
      <div className="layoutSistema">
        {menuAberto && (
          <Menu
            setTela={setTela}
            tipoUsuario={tipoUsuario}
            setMenuAberto={setMenuAberto}
            onSair={sairDoSistema}
          />
        )}

        <main className="conteudoSistema">
          <h1>Histórico de Presenças</h1>

          {presencas.length === 0 ? (
            <p>Nenhuma presença registrada.</p>
          ) : (
            <div className="lista">
              {[...presencas]
                .reverse()
                .map((presenca, index) => (
                  <div className="cardAluno" key={index}>
                    {presenca.foto && (
                      <img
                        src={presenca.foto}
                        alt={presenca.nome}
                        className="fotoAlunoLista"
                      />
                    )}
                    <h2>{presenca.nome}</h2>
                    <p>Data: {presenca.data}</p>
                    <p>Hora: {presenca.hora}</p>
                  </div>
                ))}
            </div>
          )}

          <button
            onClick={() => {
              const confirmar = confirm(
                "Deseja apagar todo o histórico de presenças?"
              );

              if (!confirmar) return;

              if (supabaseConfigurado) {
                alert("O historico online nao pode ser apagado apenas neste dispositivo.");
                return;
              }

              setPresencas([]);
              setAlunos((prev) =>
                prev.map((aluno) => ({
                  ...aluno,
                  presencas: [],
                }))
              );
              localStorage.removeItem(STORAGE_KEYS.presencas);

              alert("Histórico apagado com sucesso 🗑️");
            }}
          >
            Limpar Histórico
          </button>

          <button onClick={() => setTela("dashboard")}>
            Voltar
          </button>
        </main>
      </div>
    );
  }

  if (tela === "portalProfessor") {
    const fotoProfessor = fotoTemporariaPertenceAoContextoAtual()
      ? foto
      : usuarioLogado?.fotoUrl || usuarioLogado?.foto || "";

    return (
      <div className="layoutSistema">

        {menuAberto && (
          <>
            <div
              className="fundoMenuMobile"
              onClick={() => {
                setMenuAberto(false);
                document.body.style.overflow = "auto";
              }}
            ></div>

            <Menu
              setTela={setTela}
              tipoUsuario={tipoUsuario}
              setMenuAberto={setMenuAberto}
              onSair={sairDoSistema}
            />
          </>
        )}

        <main className="conteudoSistema">

          <h1>Portal do Professor</h1>

          <div className="cardAluno">

            <h2>{usuarioLogado?.nome}</h2>

            {fotoProfessor && (
              <img
                src={fotoProfessor}
                alt="Professor"
                className="fotoAlunoLista"
              />
            )}

            <p>Graduação: {graduacaoProfessor || "Não informado"}</p>

            <p>🎯 Especialidade: {especialidadeProfessor || "Não informado"}</p>

            <p>Área do professor</p>

            <div className="estatisticas">
              <CardEstatistica
                titulo="Total de Alunos"
                valor={alunos.length}
              />

              <CardEstatistica
                titulo="Turma Kids"
                valor={totalKids}
              />

              <CardEstatistica
                titulo="Turma Adultos"
                valor={totalAdultos}
              />

              <CardEstatistica
                titulo="Presenças Hoje"
                valor={presencasHoje}
              />
            </div>

            <button onClick={() => setTela("lista")}>
              Ver Alunos
            </button>

            <button onClick={() => setTela("scanner")}>
              Registrar Presença por QR Code
            </button>

            <button
              onClick={() => {
                setNovaSenha("");
                setConfirmarSenha("");

                if (!modoEditarPerfil) {
                  setUsuarioAluno(usuarioLogado?.usuario || "");
                }

                setModoEditarPerfil(!modoEditarPerfil);
              }}
            >
              {modoEditarPerfil
                ? "Cancelar edição"
                : "Completar meu cadastro"}
            </button>

            <button
              onClick={sairDoSistema}
            >
              Sair
            </button>

            {modoEditarPerfil && (
              <div className="formulario">

                <input
                  type="text"
                  placeholder="Usuário do professor"
                  value={usuarioAluno}
                  onChange={(e) => setUsuarioAluno(e.target.value)}
                />

                <input
                  type="text"
                  placeholder="Telefone"
                  value={telefone}
                  onChange={(e) => setTelefone(e.target.value)}
                />

                <input
                  type="text"
                  placeholder="Especialidade"
                  value={especialidadeProfessor}
                  onChange={(e) =>
                    setEspecialidadeProfessor(e.target.value)
                  }
                />

                <input
                  type="text"
                  placeholder="Graduação"
                  value={graduacaoProfessor}
                  onChange={(e) =>
                    setGraduacaoProfessor(e.target.value)
                  }
                />

                <input
                  type="password"
                  name="novaSenhaPerfilProfessor"
                  placeholder="Nova senha"
                  autoComplete="new-password"
                  value={novaSenha}
                  onChange={(e) => setNovaSenha(e.target.value)}
                />

                <input
                  type="password"
                  name="confirmarNovaSenhaPerfilProfessor"
                  placeholder="Confirmar nova senha"
                  autoComplete="new-password"
                  value={confirmarSenha}
                  onChange={(e) => setConfirmarSenha(e.target.value)}
                />

                <textarea
                  placeholder="Observações"
                  value={observacoes}
                  onChange={(e) => setObservacoes(e.target.value)}
                />

                <div className="opcoesFotoAluno">
                  <label htmlFor="fotoProfessorCamera">
                    Tirar foto
                  </label>

                  <input
                    id="fotoProfessorCamera"
                    className="inputFotoAluno"
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={async (e) => {
                      const arquivo = e.target.files[0];
                      e.target.value = "";

                      if (arquivo) {
                        await prepararFotoParaAjuste(arquivo);
                      }
                    }}
                  />

                  <label htmlFor="fotoProfessorGaleria">
                    Escolher da galeria
                  </label>

                  <input
                    id="fotoProfessorGaleria"
                    className="inputFotoAluno"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={async (e) => {
                      const arquivo = e.target.files[0];
                      e.target.value = "";

                      if (arquivo) {
                        await prepararFotoParaAjuste(arquivo);
                      }
                    }}
                  />
                </div>

                {fotoProfessor && (
                  <>
                    <img
                      src={fotoProfessor}
                      alt="Professor"
                      className="previewFoto"
                    />

                    <button
                      type="button"
                      onClick={() => abrirAjusteFoto(fotoProfessor)}
                    >
                      Ajustar foto
                    </button>
                  </>
                )}


                <button onClick={atualizarPerfilProfessor}>
                  Salvar Cadastro
                </button>

              </div>
            )}

          </div>

        </main>

        <ModalMensagem
          modal={modalMensagem}
          onFechar={fecharModalMensagem}
        />

        {ajusteFotoAberto && (
          <AjustadorFoto
            foto={fotoParaAjustar}
            zoom={zoomFoto}
            posicaoX={posicaoFotoX}
            posicaoY={posicaoFotoY}
            onZoom={setZoomFoto}
            onPosicaoX={setPosicaoFotoX}
            onPosicaoY={setPosicaoFotoY}
            onTamanhoPreview={setTamanhoPreviewFoto}
            onCancelar={cancelarAjusteFoto}
            onConfirmar={confirmarAjusteFoto}
          />
        )}

      </div>
    );
  }

  if (tela === "portalAluno") {
    const fotoTemporariaAlunoPortal = fotoTemporariaPertenceAoContextoAtual()
      ? foto
      : "";
    const fotoAlunoPortal =
      fotoTemporariaAlunoPortal ||
      alunoDoPortal?.foto ||
      alunoDoPortal?.fotoUrl ||
      "";
    const inicialAlunoPortal = String(alunoDoPortal?.nome || usuarioLogado?.nome || "A")
      .trim()
      .charAt(0)
      .toUpperCase();

    return (
      <div className="layoutSistema">

        {menuAberto && (
          <>
            <div
              className="fundoMenuMobile"
              onClick={() => {
                setMenuAberto(false);
                document.body.style.overflow = "auto";
              }}
            ></div>

            <Menu
              setTela={setTela}
              tipoUsuario={tipoUsuario}
              setMenuAberto={setMenuAberto}
              onSair={sairDoSistema}
            />
          </>
        )}

        <main className="conteudoSistema">

          <h1>Portal do Aluno</h1>

          <div className="cardAluno">

            <h2>{usuarioLogado?.nome}</h2>

            {fotoAlunoPortal ? (
              <img
                src={fotoAlunoPortal}
                alt="Foto do aluno"
                className="fotoAlunoLista"
              />
            ) : (
              <div
                className="fotoAlunoLista"
                aria-label="Aluno sem foto cadastrada"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "#111827",
                  color: "#f59e0b",
                  fontSize: "3rem",
                  fontWeight: 800,
                }}
              >
                {inicialAlunoPortal || "A"}
              </div>
            )}

            <p>Resumo financeiro e dados de acesso do aluno.</p>
            <div className="resumoFinanceiroAluno">
              <h3>Resumo do mes</h3>
              {(() => {
                const resumo = obterResumoFinanceiro(alunoDoPortal);

                return (
                  <>
                    <div className="linhaResumoFinanceiro destaque">
                      <span>Status</span>
                      <strong style={{ color: resumo.cor }}>{resumo.status}</strong>
                    </div>
                    <div className="linhaResumoFinanceiro">
                      <span>Cobranca</span>
                      <strong>{resumo.cobranca}</strong>
                    </div>
                    <div className="linhaResumoFinanceiro">
                      <span>Mensalidade</span>
                      <strong>{resumo.valorBase}</strong>
                    </div>
                    {verificarVencimento(alunoDoPortal) === "Vencido" && (
                      <div className="linhaResumoFinanceiro alerta">
                        <span>Valor atualizado</span>
                        <strong>{resumo.valorAtualizado}</strong>
                      </div>
                    )}
                    <div className="avisoResumoFinanceiro" style={{ borderColor: resumo.cor }}>
                      {resumo.mensagem}
                    </div>
                    <div className="linhaResumoFinanceiro">
                      <span>Ultimo pagamento</span>
                      <strong>{resumo.ultimoPagamento}</strong>
                    </div>
                  </>
                );
              })()}
            </div>

            {alunoDoPortal?.statusPagamento === "Aguardando" && (
              <div className="cardAluno">
                <h3>Pagamento enviado</h3>

                <p>Seu comprovante foi enviado para analise.</p>

                <p>Aguarde a confirmacao da secretaria.</p>
              </div>
            )}

            <button
              onClick={() => {
                setNovaSenha("");
                setConfirmarSenha("");
                setModoEditarPerfil(!modoEditarPerfil);
              }}
            >
              {modoEditarPerfil
                ? "Cancelar edição"
                : "Completar meu cadastro"}
            </button>

            {modoEditarPerfil && (
              <div className="formulario">

                <input
                  type="text"
                  placeholder="Telefone"
                  value={telefone}
                  onChange={(e) => setTelefone(e.target.value)}
                />

                <input
                  type="text"
                  placeholder="Responsável"
                  value={responsavel}
                  onChange={(e) => setResponsavel(e.target.value)}
                />

                <input
                  type="text"
                  placeholder="Tipo sanguíneo"
                  value={tipoSanguineo}
                  onChange={(e) => setTipoSanguineo(e.target.value)}
                />

                <textarea
                  placeholder="Problemas de saúde"
                  value={saude}
                  onChange={(e) => setSaude(e.target.value)}
                />

                <textarea
                  placeholder="Medicamentos"
                  value={medicamentos}
                  onChange={(e) => setMedicamentos(e.target.value)}
                />

                <textarea
                  placeholder="Observações"
                  value={observacoes}
                  onChange={(e) => setObservacoes(e.target.value)}
                />

                <input
                  type="text"
                  placeholder="Usuario do portal"
                  value={usuarioAluno}
                  onChange={(e) => setUsuarioAluno(e.target.value)}
                />

                <input
                  type="password"
                  name="novaSenhaPerfilAluno"
                  placeholder="Nova senha"
                  autoComplete="new-password"
                  value={novaSenha}
                  onChange={(e) => setNovaSenha(e.target.value)}
                />

                <input
                  type="password"
                  name="confirmarNovaSenhaPerfilAluno"
                  placeholder="Confirmar nova senha"
                  autoComplete="new-password"
                  value={confirmarSenha}
                  onChange={(e) => setConfirmarSenha(e.target.value)}
                />

                <div className="opcoesFotoAluno">
                  <label htmlFor="fotoPortalAlunoCamera">
                    Tirar foto
                  </label>

                  <input
                    id="fotoPortalAlunoCamera"
                    className="inputFotoAluno"
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={async (e) => {
                      const arquivo = e.target.files[0];
                      e.target.value = "";

                      if (arquivo) {
                        await prepararFotoParaAjuste(arquivo);
                      }
                    }}
                  />

                  <label htmlFor="fotoPortalAlunoGaleria">
                    Escolher da galeria
                  </label>

                  <input
                    id="fotoPortalAlunoGaleria"
                    className="inputFotoAluno"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={async (e) => {
                      const arquivo = e.target.files[0];
                      e.target.value = "";

                      if (arquivo) {
                        await prepararFotoParaAjuste(arquivo);
                      }
                    }}
                  />
                </div>

                {fotoAlunoPortal && (
                  <>
                    <img
                      src={fotoAlunoPortal}
                      alt="Foto do aluno"
                      className="previewFoto"
                    />

                    <button
                      type="button"
                      onClick={() => abrirAjusteFoto(fotoAlunoPortal)}
                    >
                      Ajustar foto
                    </button>
                  </>
                )}

                <button onClick={atualizarPerfilAluno}>
                  Salvar meu cadastro
                </button>

              </div>
            )}

            <button onClick={() => setMostrarPix(!mostrarPix)}>
              {mostrarPix ? "Ocultar PIX" : "Ver PIX"}
            </button>

            {mostrarPix && (
              <div className="cardAluno">
                <h3>Pagamento via PIX</h3>

                <QRCodeCanvas
                  value={`PIX - ${usuarioLogado?.nome} - ${formatarMoeda(alunoDoPortal?.mensalidade)}`}
                />

                <p>Chave PIX: 002.450.712-10</p>
                <p>
                  Valor: {formatarMoeda(alunoDoPortal?.mensalidade)}
                </p>
                <p>Beneficiário: Ariramba Jiu-Jitsu School</p>
              </div>
            )}

            <div className="seletorComprovante">
              <label htmlFor="comprovantePagamentoAluno">
                Selecionar comprovante
              </label>
              <span>
                {nomeComprovanteSelecionado || "Nenhum comprovante selecionado"}
              </span>
              <small>Imagem ou PDF do comprovante</small>
              <input
                id="comprovantePagamentoAluno"
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                onChange={(e) => {

                  const arquivo = e.target.files[0];

                  if (arquivo) {
                    setNomeComprovanteSelecionado(arquivo.name);

                    const leitor = new FileReader();

                    leitor.onloadend = () => {
                      setComprovanteSelecionado(leitor.result);
                    };

                    leitor.readAsDataURL(arquivo);
                  }
                }}
              />
            </div>

            <button
              disabled={pagamentoEmAndamento}
              onClick={() => informarPagamento(alunoDoPortal.id)}
            >
              {pagamentoEmAndamento ? "Enviando..." : "Informar Pagamento"}
            </button>

            <button onClick={() => setMostrarCarteirinhaAluno(!mostrarCarteirinhaAluno)}>
              {mostrarCarteirinhaAluno
                ? "Ocultar Carteirinha"
                : "Minha Carteirinha"}
            </button>

            {mostrarCarteirinhaAluno && (
              <div className="carteirinhaDigitalPortal">
                <h3>Carteirinha Digital</h3>

                <div className="carteiraHorizontal">
                  <div className="fotoCarteiraPortal">
                    {(alunoDoPortal?.foto || alunoDoPortal?.fotoUrl) ? (
                      <img
                        src={alunoDoPortal.foto || alunoDoPortal.fotoUrl}
                        alt={alunoDoPortal.nome}
                      />
                    ) : (
                      <span>Sem foto</span>
                    )}
                  </div>

                  <div className="dadosCarteiraPortal">
                    <strong>{alunoDoPortal?.nome || usuarioLogado?.nome}</strong>
                    <span>Ariramba Jiu-Jitsu School</span>
                    <span>Faixa: {alunoDoPortal?.faixa || "Nao informada"}</span>
                    <span>Grau: {alunoDoPortal?.grau || "Nao informado"}</span>
                    <span>Turma: {alunoDoPortal?.turma || "Adultos"}</span>
                    <span
                      className={
                        verificarVencimento(alunoDoPortal) === "Pago"
                          ? "statusCarteira ativo"
                          : verificarVencimento(alunoDoPortal) === "Vencido"
                            ? "statusCarteira vencido"
                            : "statusCarteira pendente"
                      }
                    >
                      Status:{" "}
                      {verificarVencimento(alunoDoPortal) === "Pago"
                        ? "Ativo"
                        : verificarVencimento(alunoDoPortal) === "Vencido"
                          ? "Vencido"
                          : "Pendente"}
                    </span>
                    <span>Cobranca: {formatarDataCobranca(alunoDoPortal)}</span>
                  </div>

                  <div className="qrCarteiraPortal" id="qrCarteirinhaAluno">
                    <QRCodeCanvas value={criarValorQRCodeAluno(alunoDoPortal)} size={108} />
                    <small>QR de presenca</small>
                  </div>
                </div>

                <button onClick={() => baixarCarteirinhaPDF(alunoDoPortal)}>
                  Baixar Carteirinha PDF
                </button>
              </div>
            )}

            <button onClick={() => setMostrarHistoricoAluno(!mostrarHistoricoAluno)}>
              {mostrarHistoricoAluno ? "Ocultar Histórico" : "Histórico Financeiro"}
            </button>

            {mostrarHistoricoAluno && (
              <div className="cardAluno">

                <h3>Histórico Financeiro</h3>

                {alunoDoPortal?.historicoPagamentos?.length > 0 ? (
                  alunoDoPortal.historicoPagamentos.map((pagamento, index) => (
                    <p key={index}>
                      {pagamento.data} - {formatarMoeda(pagamento.valor)}
                    </p>
                  ))
                ) : (
                  <p>Nenhum pagamento registrado</p>
                )}

              </div>
            )}

            <button
              onClick={sairDoSistema}
            >
              Sair
            </button>

          </div>

        </main>

        <ModalMensagem
          modal={modalMensagem}
          onFechar={fecharModalMensagem}
        />

        {ajusteFotoAberto && (
          <AjustadorFoto
            foto={fotoParaAjustar}
            zoom={zoomFoto}
            posicaoX={posicaoFotoX}
            posicaoY={posicaoFotoY}
            onZoom={setZoomFoto}
            onPosicaoX={setPosicaoFotoX}
            onPosicaoY={setPosicaoFotoY}
            onTamanhoPreview={setTamanhoPreviewFoto}
            onCancelar={cancelarAjusteFoto}
            onConfirmar={confirmarAjusteFoto}
          />
        )}

      </div>
    );
  }

  if (tela === "scanner") {
    return (
      <div className="layoutSistema">
        {menuAberto && (
          <Menu
            setTela={setTela}
            tipoUsuario={tipoUsuario}
            setMenuAberto={setMenuAberto}
            onSair={sairDoSistema}
          />
        )}

        <main className="conteudoSistema">
          <h1>Scanner QR Code</h1>

          <div className="scannerPainel">
            <div id="reader" key={scannerKey}></div>

            <div className="scannerStatus">
              {statusScanner}
            </div>

            <button
              type="button"
              onClick={() => {
                setStatusScanner("Reiniciando camera...");
                setScannerKey((valor) => valor + 1);
              }}
            >
              Reiniciar camera
            </button>

            <div className="seletorComprovante scannerArquivo">
              <label htmlFor="arquivoQRCodeScanner">
                Ler QR por imagem
              </label>
              <span>
                {nomeArquivoScanner || "Nenhuma imagem selecionada"}
              </span>
              <small>Use uma foto nítida da carteirinha</small>
              <input
                id="arquivoQRCodeScanner"
                type="file"
                accept=".jpg,.jpeg,.png,image/jpeg,image/png"
                onChange={(e) => {
                  const arquivo = e.target.files[0];
                  lerQRCodePorArquivo(arquivo);
                  e.target.value = "";
                }}
              />
            </div>

            <div id="readerArquivo" className="readerArquivoOculto"></div>
          </div>

          <button onClick={() => setTela(tipoUsuario === "professor" ? "portalProfessor" : "dashboard")}>
            Voltar
          </button>
        </main>
      </div>
    );
  }

  if (imagemComprovante) {
    return (
      <div className="modalComprovante">
        <img src={imagemComprovante} alt="Comprovante ampliado" />

        <button onClick={() => setImagemComprovante(null)}>
          Fechar
        </button>
      </div>
    );
  }

  return (
    <div className="layoutSistema">
      {menuAberto && (
        <>
          <div
            className="fundoMenuMobile"
            onClick={() => {
              setMenuAberto(false);
              document.body.style.overflow = "auto";
            }}
          ></div>

          <Menu
            setTela={setTela}
            tipoUsuario={tipoUsuario}
            setMenuAberto={setMenuAberto}
            onSair={sairDoSistema}
          />
        </>
      )}

      <main className={`conteudoSistema ${tipoUsuario === "diretor" ? "dashboardDiretor" : ""}`}>
        <button
          className="botaoMenuMobile"
          onClick={() => setMenuAberto(!menuAberto)}
        >
          ☰
        </button>
        <div className={`topoPainel ${tipoUsuario === "diretor" ? "topoPainelDiretor" : ""}`}>

          <div>
            <h1 className="tituloPainel">
              <span className="statusOnline"></span>

              {tipoUsuario === "diretor" ? "Painel do Diretor" : "Painel Inicial"}
            </h1>

            <SubtituloTela>
              Bem-vindo, {usuarioLogado?.nome}
            </SubtituloTela>
          </div>

          <div className={tipoUsuario === "diretor" ? "acoesTopoPainel" : ""}>
            <div className="relogioPainel">
              {horaAtual}
            </div>

            <button
              className="botaoLogout"
              onClick={sairDoSistema}
            >
              Sair do Sistema
            </button>
          </div>

        </div>

        <section className={`heroPainel ${tipoUsuario === "diretor" ? "heroPainelDiretor" : ""}`}>
          {tipoUsuario === "diretor" ? (
            <>
              <div className="heroConteudoDiretor">
                <span className="etiquetaDashboard">Gestão administrativa</span>
                <h2>ARIRAMBA JIU-JITSU SCHOOL</h2>
                <p>Visão executiva de alunos, presenças, turmas e financeiro.</p>
              </div>

              <div className="heroResumoDiretor">
                <div>
                  <span>Recebido</span>
                  <strong>{formatarMoeda(totalArrecadado)}</strong>
                </div>

                <div>
                  <span>A receber</span>
                  <strong>{formatarMoeda(totalPendenteReceber)}</strong>
                </div>

                <div>
                  <span>Previsão mensal</span>
                  <strong>{formatarMoeda(valorEsperadoMes)}</strong>
                </div>
              </div>
            </>
          ) : (
            <>
              <h3>Bem-vindo ao painel</h3>
              <h2>ARIRAMBA JIU-JITSU SCHOOL</h2>
              <p>Gerencie alunos, presenças, pagamentos e relatórios.</p>
            </>
          )}
        </section>

        <div className={`estatisticas ${tipoUsuario === "diretor" ? "estatisticasDiretor" : ""}`}>
          <CardEstatistica
            titulo="Total de Alunos"
            valor={alunos.length}
          />

          <CardEstatistica
            titulo="Presenças Hoje"
            valor={presencasHoje}
          />

          <CardEstatistica
            titulo="Turma Kids"
            valor={totalKids}
          />

          <CardEstatistica
            titulo="Turma Adultos"
            valor={totalAdultos}
          />

          {tipoUsuario === "diretor" && (
            <>
              <CardEstatistica
                titulo="Mensalidades Pagas"
                valor={totalPagos}
              />

              <CardEstatistica
                titulo="Mensalidades Pendentes"
                valor={totalPendentes}
              />

              <CardEstatistica
                titulo="Mensalidades Vencidas"
                valor={totalVencidos}
              />

              <CardEstatistica
                titulo="Aguardando Confirmação"
                valor={pagamentosAguardando.length}
              />
            </>
          )}

        </div>

        {tipoUsuario === "diretor" && (
          <section className="dashboardGraficosDiretor">
            <article className="cardDashboardDiretor graficoResumoFinanceiro">
              <div className="cabecalhoCardDashboard">
                <span>Financeiro</span>
                <h2>Resumo das mensalidades</h2>
              </div>

              <div className="listaBarrasDashboard">
                {resumoFinanceiroDashboard.map((item) => (
                  <div className="linhaBarraDashboard" key={item.rotulo}>
                    <div className="linhaBarraTexto">
                      <span>{item.rotulo}</span>
                      <strong>{item.valor}</strong>
                    </div>

                    <div className="trilhoBarraDashboard">
                      <span
                        className={`preenchimentoBarraDashboard ${item.classe}`}
                        style={{ width: `${Math.max((item.valor / maxResumoFinanceiro) * 100, item.valor > 0 ? 8 : 0)}%` }}
                      ></span>
                    </div>
                  </div>
                ))}
              </div>
            </article>

            <article className="cardDashboardDiretor graficoArrecadacao">
              <div className="cabecalhoCardDashboard">
                <span>Receita</span>
                <h2>Arrecadação mensal</h2>
              </div>

              {arrecadacaoMensalDashboard.length === 0 ? (
                <p className="estadoVazioDashboard">
                  Sem pagamentos confirmados com data para exibir.
                </p>
              ) : (
                <div className="graficoColunasDashboard">
                  {arrecadacaoMensalDashboard.map((item) => (
                    <div className="colunaDashboard" key={item.chave}>
                      <div className="colunaValorDashboard">
                        {formatarMoeda(item.valor)}
                      </div>

                      <span
                        className="colunaPreenchimentoDashboard"
                        style={{ height: `${Math.max((item.valor / maxArrecadacaoMensalDashboard) * 100, 12)}%` }}
                      ></span>

                      <small>{item.rotulo}</small>
                    </div>
                  ))}
                </div>
              )}
            </article>

            <article className="cardDashboardDiretor graficoPresenca">
              <div className="cabecalhoCardDashboard">
                <span>Presença</span>
                <h2>Kids x Adulto hoje</h2>
              </div>

              <div className="listaBarrasDashboard">
                {presencaTurmasDashboard.map((item) => (
                  <div className="linhaBarraDashboard" key={item.rotulo}>
                    <div className="linhaBarraTexto">
                      <span>{item.rotulo}</span>
                      <strong>{item.valor}</strong>
                    </div>

                    <div className="trilhoBarraDashboard">
                      <span
                        className="preenchimentoBarraDashboard presenca"
                        style={{ width: `${Math.max((item.valor / maxPresencasTurmaDashboard) * 100, item.valor > 0 ? 8 : 0)}%` }}
                      ></span>
                    </div>

                    <small>{item.alunos} aluno(s) na turma</small>
                  </div>
                ))}
              </div>
            </article>

            <article className="cardDashboardDiretor graficoCadastros">
              <div className="cabecalhoCardDashboard">
                <span>Cadastros</span>
                <h2>Evolução de alunos</h2>
              </div>

              <p className="estadoVazioDashboard">
                A fonte atual dos alunos não traz uma data confiável de cadastro.
              </p>
            </article>
          </section>
        )}

        <section className={tipoUsuario === "diretor" ? "dashboardOperacionalDiretor" : ""}>
          <div className={`cardAluno ${tipoUsuario === "diretor" ? "cardDashboardDiretor notificacoesDashboard" : ""}`}>
            {tipoUsuario === "diretor" ? (
              <div className="cabecalhoCardDashboard">
                <span>Alertas</span>
                <h2>Notificações do Sistema</h2>
              </div>
            ) : (
              <h2>Notificações do Sistema</h2>
            )}

            {avisosDoPainel.length === 0 ? (
              <p>Nenhuma notificação no momento.</p>
            ) : (
              avisosDoPainel.slice(0, 5).map((aviso) => (
                <p key={aviso.id}>
                  {aviso.mensagem} - {aviso.data}
                </p>
              ))
            )}

            <button onClick={() => setAvisos([])}>
              Limpar notificações
            </button>

          </div>

          {tipoUsuario === "diretor" && (
            <div className="cardDashboardDiretor atividadesDashboard">
              <div className="cabecalhoCardDashboard">
                <span>Movimento</span>
                <h2>Atividades recentes</h2>
              </div>

              {atividadesRecentesDashboard.length === 0 ? (
                <p className="estadoVazioDashboard">
                  Nenhuma atividade registrada até o momento.
                </p>
              ) : (
                <div className="listaAtividadesDashboard">
                  {atividadesRecentesDashboard.map((atividade) => (
                    <div className="itemAtividadeDashboard" key={atividade.id}>
                      <span>{atividade.tipo}</span>
                      <strong>{atividade.titulo}</strong>
                      <small>{atividade.detalhe}</small>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>

        {tipoUsuario === "diretor" && (
          <section className="dashboardAdministracaoDiretor">
            <div className="cardAluno cardDashboardDiretor armazenamentoLocal">
              <h2>Acesso do Mestre</h2>

              <p>
                Usuário atual: {usuarioLogado?.usuario || "não informado"}
              </p>

              <button onClick={abrirEdicaoAcessoMestre}>
                Alterar usuário e senha do mestre
              </button>

              {modoEditarPerfil && (
                <div className="formulario formularioAcessoMestre">
                  <input
                    type="text"
                    placeholder="Usuário do mestre"
                    value={usuarioAluno}
                    onChange={(e) => setUsuarioAluno(e.target.value)}
                  />

                  <input
                    type="password"
                    placeholder="Nova senha"
                    value={novaSenha}
                    onChange={(e) => setNovaSenha(e.target.value)}
                  />

                  <input
                    type="password"
                    placeholder="Confirmar nova senha"
                    value={confirmarSenha}
                    onChange={(e) => setConfirmarSenha(e.target.value)}
                  />

                  <button onClick={atualizarAcessoMestre}>
                    Salvar acesso do mestre
                  </button>

                  <button
                    className="botaoVoltar"
                    onClick={() => {
                      setModoEditarPerfil(false);
                      setUsuarioAluno("");
                      setNovaSenha("");
                      setConfirmarSenha("");
                    }}
                  >
                    Cancelar
                  </button>
                </div>
              )}
            </div>

            <div className="cardAluno armazenamentoLocal">
              <h2>Armazenamento</h2>

              <p
                className={
                  supabaseConfigurado
                    ? "statusBancoOnline"
                    : "statusBancoLocal"
                }
              >
                {!supabaseConfigurado
                  ? "Modo local até configurar o Supabase"
                  : diretorOnlineLogado
                    ? "Banco online conectado como diretor"
                    : "Banco online configurado, login atual é local"}
              </p>

              <p>
                {!supabaseConfigurado
                  ? "Alunos, usuários, pagamentos e presenças estão salvos neste navegador."
                  : diretorOnlineLogado
                    ? "Sistema pronto para uso online. Cadastros novos ficam no banco e aparecem em outros dispositivos."
                    : "Entre com o diretor online para enviar ou carregar alunos online."}
              </p>

              {erroArmazenamento && (
                <p className="alertaArmazenamento">
                  {erroArmazenamento}
                </p>
              )}

              <button onClick={exportarBackup}>
                Baixar Backup
              </button>

              {supabaseConfigurado && (
                <>
                  <button
                    onClick={enviarAlunosParaBancoOnline}
                    disabled={sincronizacaoOnline !== "" || !diretorOnlineLogado}
                  >
                    {sincronizacaoOnline === "enviando"
                      ? "Enviando..."
                      : "Importar Alunos Antigos para Banco Online"}
                  </button>

                  <button
                    onClick={carregarAlunosDoBancoOnline}
                    disabled={sincronizacaoOnline !== "" || !diretorOnlineLogado}
                  >
                    {sincronizacaoOnline === "carregando"
                      ? "Carregando..."
                      : "Carregar Alunos do Banco Online"}
                  </button>
                </>
              )}

              <label className="botaoImportarBackup" htmlFor="importarBackupSistema">
                Restaurar Backup
              </label>

              <input
                id="importarBackupSistema"
                type="file"
                accept="application/json,.json"
                onChange={importarBackup}
              />
            </div>
          </section>
        )}

        <div className="cardsDashboard">
          {tipoUsuario === "diretor" && (
            <button
              onClick={() => {
                limparFormulario();
                setTela("cadastro");
              }}
            >
              Cadastrar Aluno
            </button>
          )}
          {tipoUsuario === "diretor" && (
            <button
              onClick={() => {
                limparFormulario();
                setTela("cadastroProfessor");
              }}
            >
              Cadastrar Professor
            </button>
          )}
          <button onClick={() => setTela("lista")}>Lista de Alunos</button>
          <button onClick={() => setTela("scanner")}>
            Escanear QR Code
          </button>
          <button onClick={() => setTela("historico")}>
            Presenças
          </button>

          {tipoUsuario === "diretor" && (
            <>
              <button onClick={() => setTela("mensalidades")}>
                Mensalidades
              </button>

              <button onClick={() => setTela("pagamentos")}>
                Pagamentos
              </button>

              <button onClick={() => setTela("relatorios")}>
                Relatórios
              </button>
            </>
          )}

          <button
            onClick={sairDoSistema}
          >
            Sair
          </button>
        </div>
      </main>
    </div>
  );

  function CardEstatistica({ titulo, valor }) {

    function escolherIcone(titulo) {

      if (titulo.includes("Alunos")) return (
        <>
          <circle cx="12" cy="8" r="3.2" />
          <path d="M5 20c1.2-4 4-6 7-6s5.8 2 7 6" />
        </>
      );

      if (titulo.includes("Presenças")) return (
        <>
          <path d="M9 11l2 2 4-5" />
          <rect x="4" y="4" width="16" height="16" rx="3" />
        </>
      );

      if (titulo.includes("Pagas")) return (
        <>
          <path d="M12 3v18" />
          <path d="M17 7.5c-.9-1-2.4-1.5-4.2-1.5-2.5 0-4.3 1.1-4.3 2.9 0 4.3 8.7 1.8 8.7 6.3 0 1.8-1.9 2.8-4.5 2.8-2 0-3.8-.7-4.8-1.9" />
        </>
      );

      if (titulo.includes("Pendentes")) return (
        <>
          <circle cx="12" cy="12" r="8" />
          <path d="M12 7v5l3 2" />
        </>
      );

      if (titulo.includes("Vencidas")) return (
        <>
          <path d="M12 8v5" />
          <path d="M12 17h.01" />
          <path d="M10.3 4.4 3.8 17a2 2 0 0 0 1.8 3h12.8a2 2 0 0 0 1.8-3L13.7 4.4a1.9 1.9 0 0 0-3.4 0Z" />
        </>
      );

      if (titulo.includes("Aguardando")) return (
        <>
          <path d="M6 3h12" />
          <path d="M6 21h12" />
          <path d="M8 3v5c0 2.2 1.6 4 4 4s4 1.8 4 4v5" />
          <path d="M16 3v5c0 2.2-1.6 4-4 4s-4 1.8-4 4v5" />
        </>
      );

      if (titulo.includes("Kids")) return (
        <>
          <circle cx="9" cy="8" r="2.6" />
          <path d="M5 19c.8-3.1 2.3-4.8 4-4.8 1.2 0 2.2.7 3 2" />
          <circle cx="16" cy="9" r="2.2" />
          <path d="M13 19c.7-2.7 1.8-4.1 3-4.1 1.5 0 2.7 1.6 3.4 4.1" />
        </>
      );

      if (titulo.includes("Adultos")) return (
        <>
          <circle cx="12" cy="7" r="3" />
          <path d="M7 21v-4.2c0-2.4 2-4.3 5-4.3s5 1.9 5 4.3V21" />
          <path d="M9 21h6" />
        </>
      );

      return (
        <>
          <path d="M20 6 9 17l-5-5" />
        </>
      );
    }

    return (
      <div className={`cardEstatistica ${titulo.toLowerCase()}`}>

        <svg
          className="iconeCard"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          {escolherIcone(titulo)}
        </svg>

        <h3>{titulo}</h3>

        <h2>
          <ContadorAnimado valor={valor} />
        </h2>

      </div>
    );
  }

  function Botao({
    children,
    onClick,
    className = "",
    tipo = "padrao",
  }) {
    return (
      <button
        className={`botao ${tipo} ${className}`}
        type="button"
        onClick={onClick}
      >
        {children}
      </button>
    );
  }

  function CardAluno({ children }) {
    return (
      <div className="cardAluno">
        {children}
      </div>
    );
  }

  function TituloTela({ titulo }) {
    return <h1>{titulo}</h1>;
  }

  function SubtituloTela({ children }) {
    return <h3>{children}</h3>;
  }

  function Menu({ setTela, tipoUsuario, setMenuAberto, onSair }) {

    function navegar(telaDestino) {
      setTela(telaDestino);
      setMenuAberto(false);
    }

    return (
      <aside className="menuLateral">

        <img src={logo} alt={`Logo ${APP_NAME}`} />

        <h2>ARIRAMBA</h2>

        <p>JIU-JITSU</p>

        {tipoUsuario !== "aluno" && (
          <button onClick={() => navegar("dashboard")}>
            Painel Inicial
          </button>
        )}

        {tipoUsuario === "diretor" && (
          <button
            onClick={() => {
              limparFormulario();
              navegar("cadastro");
            }}
          >
            Cadastrar Aluno
          </button>
        )}

        {tipoUsuario === "diretor" && (
          <button
            onClick={() => {
              limparFormulario();
              navegar("cadastroProfessor");
            }}
          >
            Cadastrar Professor
          </button>
        )}

        {tipoUsuario !== "aluno" && (
          <button onClick={() => navegar("lista")}>
            Lista de Alunos
          </button>
        )}

        {tipoUsuario !== "aluno" && (
          <button onClick={() => navegar("scanner")}>
            Escanear QR Code
          </button>
        )}

        {tipoUsuario !== "aluno" && (
          <button onClick={() => navegar("historico")}>
            Histórico de Presenças
          </button>
        )}

        {tipoUsuario === "diretor" && (
          <>
            <button onClick={() => navegar("mensalidades")}>
              Mensalidades
            </button>

            <button onClick={() => navegar("pagamentos")}>
              Pagamentos
            </button>

            <button onClick={() => navegar("relatorios")}>
              Relatórios
            </button>
          </>
        )}

        <button onClick={onSair}>
          Sair
        </button>

      </aside>
    );
  }

}

export default App;
