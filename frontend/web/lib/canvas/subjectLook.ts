import { isProgrammingTopic } from "../codeSpec";
import { isMathsTopic } from "./predictCard";

/** Computer-science topics that are not programming as such: number systems, logic, algorithms, hardware. */
const COMPUTING = /\b(computer science|computing|algorithms?|pseudo-?code|flow ?charts?|binary (numbers?|search|trees?|addition)|hexadecimal|denary|two'?s complement|logic gates?|boolean (logic|algebra|expressions?)|truth tables?|cpu|fetch[- ]decode[- ]execute|von neumann|dijkstra|breadth[- ]first|depth[- ]first|bfs|dfs|avl trees?|bst|heaps? sort|stacks? and queues|computational thinking|abstraction and decomposition|big ?o)\b/i;

/**
 * Is this lecture taught the Visuals Lab's way (owner, 2026-10-20) — maths or computer science?
 * Those lectures get the marker that writes the board and chalk-drawn cards; others keep their look.
 */
export function isLabLookTopic(topic: string | undefined | null): boolean {
  const t = topic ?? "";
  return isMathsTopic(t) || isProgrammingTopic(t) || COMPUTING.test(t);
}

/** A computer-science lecture (programming, algorithms, data structures, computing) — not a maths one. */
export function isCsTopic(topic: string | undefined | null): boolean {
  const t = topic ?? "";
  // A named language is programming ("Python functions" is not the maths of functions); a science
  // practical's "variables in an experiment" is not.
  if (LANGUAGE.test(t) || STRONG_CS.test(t) || CS_IN_CONTEXT.test(t) || CS_TITLE_WORD.test(t)) return true;
  if (isMathsTopic(t)) return false;
  if (/\b(experiments?|investigations?|practicals?)\b/i.test(t) && !COMPUTING.test(t)) return false;
  return isProgrammingTopic(t) || COMPUTING.test(t) || DATA_STRUCTURES.test(t);
}

// Words only computer science uses: they make a lecture CS even beside a maths word — "balanced brackets
// with a stack" and "permutations with backtracking" were taught by the maths rules (CS round 4), and
// "selection sort" and "tree traversals" by no CS rule at all.
const STRONG_CS = /\b(?:linked lists?|hash (?:tables?|maps?)|trie|prefix trees?|binary (?:search )?trees?|bsts?|avl trees?|traversals?|(?:selection|insertion|bubble|merge|quick|heap|counting|radix|shell)[- ]?sort(?:ing)?|(?:sorting|searching) algorithms?|linear search|backtracking|recursive (?:functions?|calls?|algorithms?)|two[- ]pointers?|sliding window|bit manipulation|bitwise|dynamic programming|memoi[sz]ation|greedy algorithms?|big ?o|time complexity|bfs|dfs|breadth[- ]first|depth[- ]first|dijkstra|pseudo-?code|data structures?)\b/i;

// Words other subjects use too — "caves, arches, stacks and stumps", "protein sorting", "heaps of
// sediment", "the body tries to…", "pre-order sales" were all read as CS (2026-10-22). They count only
// with computer science around them, or as a lecture's whole title ("Stacks", "Tries").
const CS_IN_CONTEXT = /\b(?:(?:using|with|via|implement(?:ing|s)?|on|onto|from) an? (?:stack|queue|heap)|stacks? and queues?|(?:call|data|undo|execution) stacks?|stacks? (?:data structures?|frames?|overflow|pointers?)|(?:priority|circular|double[- ]ended) queues?|queues? data structures?|(?:binary|min|max)[- ]heaps?|heapify|heaps? (?:data structures?|property)|push(?:ing)? and pop(?:ping)?|enqueue|dequeue|(?:stacks?|queues?|heaps?) in (?:python|java|c|javascript)|tries? data structures?)\b/i;
const CS_TITLE_WORD = /^\s*(?:stacks?|queues?|heaps?|tries|recursion)\s*$/i;

const LANGUAGE = /\b(python|javascript|typescript|java|kotlin|swift|rust|golang|ruby|php|sql|pseudo-?code)\b|c\+\+|c#/i;

const DATA_STRUCTURES = /\b(linked lists?|hash (tables?|maps?)|binary trees?|graphs? traversal|sorting algorithms?|recursion|recursive|data structures?|big ?o|time complexity|(?:for|while) loops?|loops? in (?:python|java|c|javascript)|arrays? in (?:python|java|c|javascript)|(?:python|java|javascript) (?:functions?|variables?|arrays?|lists?|loops?|classes)|lists? in python|object[- ]oriented|classes and objects)\b/i;
