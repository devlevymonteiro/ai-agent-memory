class_name ChessRules
extends RefCounted

## Regras de xadrez.
##   [ok] geometria de todas as peças, bloqueio, captura
##   [ok] avanço duplo do peão, promoção
##   [ok] xeque, xeque-mate, afogamento
##   [--] en passant, roque, empate por repetição / 50 lances  (próximo ciclo)
##
## Convenção: coord = Vector2i(file, rank), file 0..7 -> a..h, rank 0..7 -> 8..1.
## Brancas movem para rank index menor (em direção a 8); pretas para maior.
##
## Duas camadas de validação:
##   valid_moves()  = movimentos pseudo-legais (geometria pura)
##   legal_moves()  = pseudo-legais filtrados por "não deixa meu rei em xeque"
## A UI deve consumir SEMPRE legal_moves().

enum Status { ONGOING, CHECK, CHECKMATE, STALEMATE }

const FILES := 8
const RANKS := 8

## Promoção automática em rainha. Quando entrar a UI de escolha, este valor
## vira o default e `promotion_options()` alimenta o seletor.
const PROMOTION_AUTO_QUEEN := true

const KNIGHT_OFFSETS := [
	Vector2i(1, 2), Vector2i(2, 1), Vector2i(2, -1), Vector2i(1, -2),
	Vector2i(-1, -2), Vector2i(-2, -1), Vector2i(-2, 1), Vector2i(-1, 2),
]
const BISHOP_DIRS := [Vector2i(1, 1), Vector2i(1, -1), Vector2i(-1, -1), Vector2i(-1, 1)]
const ROOK_DIRS := [Vector2i(1, 0), Vector2i(-1, 0), Vector2i(0, 1), Vector2i(0, -1)]
const QUEEN_DIRS := [
	Vector2i(1, 1), Vector2i(1, -1), Vector2i(-1, -1), Vector2i(-1, 1),
	Vector2i(1, 0), Vector2i(-1, 0), Vector2i(0, 1), Vector2i(0, -1),
]
const KING_DIRS := [
	Vector2i(1, 1), Vector2i(1, -1), Vector2i(-1, -1), Vector2i(-1, 1),
	Vector2i(1, 0), Vector2i(-1, 0), Vector2i(0, 1), Vector2i(0, -1),
]

const BISHOP_LIKE := [Piece.Type.BISHOP, Piece.Type.QUEEN]
const ROOK_LIKE := [Piece.Type.ROOK, Piece.Type.QUEEN]

const PAWN_START_RANK := {true: 6, false: 1}        # rank index inicial por cor
const PAWN_FORWARD := {true: -1, false: 1}          # delta de rank index
const PAWN_PROMOTION_RANK := {true: 0, false: 7}
const NO_SQUARE := Vector2i(-1, -1)


# ------------------------------------------------------------- API pública --

## Movimentos pseudo-legais (geometria + bloqueio + captura). Não considera xeque.
static func valid_moves(from: Vector2i, type: Piece.Type, is_white: bool,
		board: Dictionary) -> Array[Vector2i]:
	var out: Array[Vector2i] = []

	match type:
		Piece.Type.PAWN:
			_pawn(from, is_white, board, out)
		Piece.Type.KNIGHT:
			_step(from, is_white, board, KNIGHT_OFFSETS, out)
		Piece.Type.BISHOP:
			_slide(from, is_white, board, BISHOP_DIRS, out)
		Piece.Type.ROOK:
			_slide(from, is_white, board, ROOK_DIRS, out)
		Piece.Type.QUEEN:
			_slide(from, is_white, board, QUEEN_DIRS, out)
		Piece.Type.KING:
			_step(from, is_white, board, KING_DIRS, out)

	return out


## Movimentos legais de verdade: pseudo-legais menos os que deixam o próprio
## rei sob ataque. É o que a UI deve chamar.
static func legal_moves(from: Vector2i, board: Dictionary) -> Array[Vector2i]:
	var piece := board.get(from) as Piece
	if piece == null:
		return []

	var out: Array[Vector2i] = []
	for to in valid_moves(from, piece.type, piece.is_white, board):
		var next := _apply_move(board, from, to)
		if not is_in_check(piece.is_white, next):
			out.append(to)
	return out


## Copia rasa do tabuleiro com o movimento aplicado. Peças são referências,
## então mutar o resultado nunca altera a partida real.
## Limitação: promoção não é aplicada na simulação (o peão continua peão na
## última fileira). Só importa em posições onde promover dá xeque no próprio
## rei — caso que desaparece quando a UI de promoção entrar.
static func _apply_move(board: Dictionary, from: Vector2i, to: Vector2i) -> Dictionary:
	var copy := board.duplicate()
	var piece := copy.get(from)
	copy.erase(from)
	copy[to] = piece
	return copy


static func is_in_check(is_white: bool, board: Dictionary) -> bool:
	var king := find_king(is_white, board)
	if king == NO_SQUARE:
		return false
	return is_square_attacked(king, not is_white, board)


static func find_king(is_white: bool, board: Dictionary) -> Vector2i:
	for coord in board:
		var piece := board[coord] as Piece
		if piece != null and piece.is_white == is_white and piece.type == Piece.Type.KING:
			return coord as Vector2i
	return NO_SQUARE


## Ataque calculado por geometria direta, sem alocar arrays de movimentos.
## Importa porque legal_moves() chama isto dezenas de vezes por jogada.
static func is_square_attacked(target: Vector2i, by_white: bool,
		board: Dictionary) -> bool:
	# peão: o atacante está na diagonal oposta ao seu avanço
	var pawn_dir: int = PAWN_FORWARD[by_white]
	for dx in [-1, 1]:
		if _is_piece(target + Vector2i(dx, -pawn_dir), board, by_white, Piece.Type.PAWN):
			return true

	# cavalo e rei (offsets simétricos)
	if _is_piece_in(target, board, by_white, Piece.Type.KNIGHT, KNIGHT_OFFSETS):
		return true
	if _is_piece_in(target, board, by_white, Piece.Type.KING, KING_DIRS):
		return true

	# deslizantes
	if _scan_attack(target, board, by_white, BISHOP_DIRS, BISHOP_LIKE):
		return true
	if _scan_attack(target, board, by_white, ROOK_DIRS, ROOK_LIKE):
		return true

	return false


static func has_any_legal_move(is_white: bool, board: Dictionary) -> bool:
	for coord in board:
		var piece := board[coord] as Piece
		if piece == null or piece.is_white != is_white:
			continue
		if not legal_moves(coord as Vector2i, board).is_empty():
			return true
	return false


## Estado do jogo para quem tem a vez de jogar.
static func status(is_white_to_move: bool, board: Dictionary) -> Status:
	var in_check := is_in_check(is_white_to_move, board)
	if has_any_legal_move(is_white_to_move, board):
		return Status.CHECK if in_check else Status.ONGOING
	return Status.CHECKMATE if in_check else Status.STALEMATE


static func status_label(state: Status) -> String:
	match state:
		Status.CHECK: return "XEQUE"
		Status.CHECKMATE: return "XEQUE-MATE"
		Status.STALEMATE: return "EMPATE (afogamento)"
		_: return ""


# ------------------------------------------------------------ promoção ------

static func needs_promotion(type: Piece.Type, is_white: bool, to: Vector2i) -> bool:
	return type == Piece.Type.PAWN and to.y == PAWN_PROMOTION_RANK[is_white]


## Ponto de extensão para a UI de escolha. Hoje devolve rainha.
static func promotion_options() -> Array:
	return [Piece.Type.QUEEN, Piece.Type.ROOK, Piece.Type.BISHOP, Piece.Type.KNIGHT]


static func promotion_choice(_is_white: bool) -> Piece.Type:
	return Piece.Type.QUEEN if PROMOTION_AUTO_QUEEN else Piece.Type.QUEEN


static func in_bounds(c: Vector2i) -> bool:
	return c.x >= 0 and c.x < FILES and c.y >= 0 and c.y < RANKS


static func algebraic(c: Vector2i) -> String:
	return "abcdefgh"[c.x] + str(8 - c.y)


# -------------------------------------------------------------- internos ----

static func _pawn(from: Vector2i, is_white: bool, board: Dictionary,
		out: Array[Vector2i]) -> void:
	var dir: int = PAWN_FORWARD[is_white]

	var one := from + Vector2i(0, dir)
	if in_bounds(one) and not board.has(one):
		out.append(one)
		var two := from + Vector2i(0, dir * 2)
		if from.y == PAWN_START_RANK[is_white] and not board.has(two):
			out.append(two)

	# capturas nas diagonais
	for dx in [-1, 1]:
		var diagonal := from + Vector2i(dx, dir)
		if not in_bounds(diagonal):
			continue
		var victim := board.get(diagonal) as Piece
		if victim != null and victim.is_white != is_white:
			out.append(diagonal)


## Peças de salto único: cavalo e rei.
static func _step(from: Vector2i, is_white: bool, board: Dictionary,
		offsets: Array, out: Array[Vector2i]) -> void:
	for offset in offsets:
		var to := from + (offset as Vector2i)
		if not in_bounds(to):
			continue
		var occupant := board.get(to) as Piece
		if occupant == null or occupant.is_white != is_white:
			out.append(to)


## Peças deslizantes: bispo, torre e rainha.
## Inclui a casa da peça inimiga e para ali; para antes da peça aliada.
static func _slide(from: Vector2i, is_white: bool, board: Dictionary,
		directions: Array, out: Array[Vector2i]) -> void:
	for direction in directions:
		var step := direction as Vector2i
		var to := from + step
		while in_bounds(to):
			var occupant := board.get(to) as Piece
			if occupant == null:
				out.append(to)
			else:
				if occupant.is_white != is_white:
					out.append(to)
				break
			to += step


static func _is_piece(at: Vector2i, board: Dictionary, is_white: bool,
		type: Piece.Type) -> bool:
	if not in_bounds(at):
		return false
	var piece := board.get(at) as Piece
	return piece != null and piece.is_white == is_white and piece.type == type


static func _is_piece_in(target: Vector2i, board: Dictionary, is_white: bool,
		type: Piece.Type, offsets: Array) -> bool:
	for offset in offsets:
		if _is_piece(target + (offset as Vector2i), board, is_white, type):
			return true
	return false


## Varre a partir de `target` até achar peça; só a primeira de cada raio conta.
static func _scan_attack(target: Vector2i, board: Dictionary, is_white: bool,
		directions: Array, wanted: Array) -> bool:
	for direction in directions:
		var step := direction as Vector2i
		var to := target + step
		while in_bounds(to):
			var piece := board.get(to) as Piece
			if piece == null:
				to += step
				continue
			if piece.is_white == is_white and piece.type in wanted:
				return true
			break
	return false
