// Banco de palavras do jogo. Escreva com acento normalmente:
// o jogo compara sem acento (CAFÉ = CAFE, MAÇÃ = MACA) e mostra o acento no fim.
// O tamanho (4 a 7 letras) é calculado sozinho — basta acrescentar palavras aqui.
const PALAVRAS = `
casa bola gato pato sapo lobo rato vaca mesa fogo água bolo dado faca fada foca galo
jogo lago lata leão mala mapa mato moto nave ovos peão pena pera pipa pote roda rosa
sala sopa suco tatu tela teto urso uvas vela vida anel asas azul bebê boca cama caos
copo dedo doce fita gelo ilha lixo luva nota osso pata pele pião rima sino vaso chão
amor arco bala bico caju cola cubo figo gema lima meia onda rede saco trem três dia
tigre zebra folha nuvem pomba peixe ninho barco carro praia pedra livro mundo campo
chuva cinto cobra corda dente disco festa forno fruta grama horta lápis leite limão
manga moeda molho nariz noite papel piano pilha pizza ponte porco rádio selva sinal
sonho tecla terra turma verde vento viola areia avião banco braço cabra caixa canto
cerca chave circo filme fundo galho garfo gente herói larva letra lousa marte melão
palco pasta prato pulga torre trevo trigo urubu corvo ferro hotel navio risco roupa
tênis vidro bruxa fruta lebre tampa tinta mágica nadar polvo dança
janela flores girafa igreja macaco ovelha queijo sapato tijolo coelho escola planta
oceano quadro toalha baleia banana boneca camelo caneta cidade coruja jacaré panela
pirata raposa sereia tomate troféu viagem abelha amigos animal brinco cabelo cavalo
chapéu cinema dragão dominó jardim lanche mágico menino pedaço pipoca salada semana
tapete tecido templo espada férias música ônibus parque pijama tambor vulcão gorila
patins pepino trator almoço xícara foguete
relógio estrela mochila sorvete tubarão futebol cadeira castelo cenoura fazenda
galinha lagosta martelo medalha morango planeta tesoura goleiro palhaço passeio
repolho sorriso lagarto ursinho desenho abacaxi cozinha espelho formiga gaivota
jaqueta máquina pantera pinguim piscina quintal soldado teclado telhado tornado
vampiro violino balanço esquilo minhoca bolacha cartola coração domingo caderno
camisas cometas tartaruga borracha
`.trim().split(/\s+/);
